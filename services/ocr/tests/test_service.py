import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from app import main
from app.contract import OcrError, Page, Word, make_line
from app.imaging import deskew, pdf_text_pages, sniff
from app.providers.google_docai import pages_from_docai
from app.providers.tesseract import page_from_tesseract

client = TestClient(main.app)
V1 = {"X-Contract-Version": "1"}


def text_pdf(lines: list[str]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    for i, line in enumerate(lines):
        c.drawString(60, 780 - i * 20, line)
    c.save()
    return buf.getvalue()


def png_bytes(size=(400, 200)) -> bytes:
    img = Image.new("RGB", size, "white")
    ImageDraw.Draw(img).text((20, 80), "Roll Number: 2410387", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class FakeProvider:
    name = "fake"

    def __init__(self, ok=True, error: OcrError | None = None):
        self.ok, self.error = ok, error

    def available(self):
        return self.ok

    def recognise(self, image, index):
        if self.error:
            raise self.error
        w = Word(text="2410387", conf=0.91, bbox=(0.1, 0.4, 0.3, 0.45))
        return Page(index=index, width=image.width, height=image.height, lines=[make_line([w])])


@pytest.fixture
def provider(monkeypatch):
    def use(p):
        monkeypatch.setitem(main.PROVIDERS, "tesseract", p)
        return p

    return use


def test_health_reports_provider_state(provider):
    provider(FakeProvider(ok=True))
    assert client.get("/health").json()["status"] == "ok"
    provider(FakeProvider(ok=False))
    res = client.get("/health")
    assert res.status_code == 503 and res.json()["status"] == "degraded"


def test_image_is_ocrd_and_returns_contract_v1(provider):
    provider(FakeProvider())
    res = client.post("/v1/ocr", files={"file": ("m.png", png_bytes(), "image/png")}, headers=V1)
    assert res.status_code == 200
    body = res.json()
    assert body["contractVersion"] == "1" and body["provider"] == "fake"
    assert body["pages"][0]["lines"][0] == {"text": "2410387", "words": [{"text": "2410387", "conf": 0.91, "bbox": [0.1, 0.4, 0.3, 0.45]}]}
    assert body["preview"]["mime"] == "image/png"


def test_digital_pdf_uses_text_layer_with_aligned_boxes(provider):
    provider(FakeProvider(ok=False))  # OCR not needed for a text-layer PDF
    pdf = text_pdf(["STATEMENT OF MARKS", "Roll Number: 2410387", "Percentage: 88.20"])
    body = client.post("/v1/ocr", files={"file": ("m.pdf", pdf, "application/pdf")}, headers=V1).json()
    assert body["provider"] == "pdf_text_layer"
    lines = body["pages"][0]["lines"]
    assert [l["text"] for l in lines] == ["STATEMENT OF MARKS", "Roll Number: 2410387", "Percentage: 88.20"]
    x0, y0, x1, y1 = lines[1]["words"][0]["bbox"]
    assert 0 < x0 < x1 < 1 and 0 < y0 < y1 < 1
    assert abs(x0 - 60 / A4[0]) < 0.01


def test_scanned_pdf_without_text_falls_back_to_ocr(provider):
    provider(FakeProvider())
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.rect(50, 50, 400, 600, fill=1)  # image-only page, no text layer
    c.save()
    body = client.post("/v1/ocr", files={"file": ("s.pdf", buf.getvalue(), "application/pdf")}, headers=V1).json()
    assert body["provider"] == "fake"


@pytest.mark.parametrize(
    "headers,payload,status,code,retryable",
    [
        ({}, png_bytes(), 400, "contract_mismatch", False),
        ({"X-Contract-Version": "2"}, png_bytes(), 400, "contract_mismatch", False),
        (V1, b"MZ\x90\x00 executable", 415, "unsupported_type", False),
        (V1, b"\x89PNG\r\n\x1a\ntruncated", 422, "unreadable_document", False),
    ],
)
def test_rejections_carry_retryable_flag(provider, headers, payload, status, code, retryable):
    provider(FakeProvider())
    res = client.post("/v1/ocr", files={"file": ("x", payload, "application/octet-stream")}, headers=headers)
    assert res.status_code == status
    assert res.json()["error"]["code"] == code
    assert res.json()["error"]["retryable"] is retryable


def test_provider_outage_is_retryable(provider):
    provider(FakeProvider(ok=False))
    res = client.post("/v1/ocr", files={"file": ("m.png", png_bytes(), "image/png")}, headers=V1)
    assert res.status_code == 503 and res.json()["error"]["retryable"] is True


def test_provider_timeout_is_retryable(provider):
    provider(FakeProvider(error=OcrError(503, "ocr_timeout", "timed out", retryable=True)))
    res = client.post("/v1/ocr", files={"file": ("m.png", png_bytes(), "image/png")}, headers=V1)
    assert res.json()["error"] == {"code": "ocr_timeout", "message": "timed out", "retryable": True}


def test_oversize_is_rejected(provider, monkeypatch):
    provider(FakeProvider())
    monkeypatch.setattr(main, "MAX_BYTES", 10)
    res = client.post("/v1/ocr", files={"file": ("m.png", png_bytes(), "image/png")}, headers=V1)
    assert res.status_code == 413


def test_tesseract_output_maps_to_lines_and_normalised_boxes():
    data = {
        "text": ["", "Roll", "Number:", "2410387", "Percentage:", "88.20"],
        "conf": [-1, 96, 95, 62, 91, 90],
        "left": [0, 100, 160, 300, 100, 260],
        "top": [0, 50, 50, 50, 90, 90],
        "width": [0, 50, 120, 90, 140, 70],
        "height": [0, 20, 20, 20, 20, 20],
        "block_num": [0, 1, 1, 1, 1, 1],
        "par_num": [0, 1, 1, 1, 1, 1],
        "line_num": [0, 1, 1, 1, 2, 2],
    }
    page = page_from_tesseract(data, 1000, 1000, 0)
    assert [l.text for l in page.lines] == ["Roll Number: 2410387", "Percentage: 88.20"]
    word = page.lines[0].words[2]
    assert word.conf == 0.62
    assert word.bbox == (0.3, 0.05, 0.39, 0.07)


def test_document_ai_response_maps_to_contract():
    text = "Roll Number: 2410387\nPercentage: 88.20\n"
    vert = lambda x0, y0, x1, y1: {"normalizedVertices": [{"x": x0, "y": y0}, {"x": x1, "y": y0}, {"x": x1, "y": y1}, {"x": x0, "y": y1}]}
    tok = lambda s, e, conf, box: {"layout": {"textAnchor": {"textSegments": [{"startIndex": s, "endIndex": e}]}, "confidence": conf, "boundingPoly": vert(*box)}}
    document = {
        "text": text,
        "pages": [
            {
                "tokens": [
                    tok(0, 5, 0.99, (0.1, 0.1, 0.15, 0.12)),
                    tok(5, 13, 0.98, (0.16, 0.1, 0.25, 0.12)),
                    tok(13, 21, 0.71, (0.26, 0.1, 0.35, 0.12)),
                    tok(21, 33, 0.97, (0.1, 0.2, 0.2, 0.22)),
                    tok(33, 39, 0.95, (0.21, 0.2, 0.28, 0.22)),
                ],
                "lines": [
                    {"layout": {"textAnchor": {"textSegments": [{"endIndex": 21}]}}},
                    {"layout": {"textAnchor": {"textSegments": [{"startIndex": 21, "endIndex": 39}]}}},
                ],
            }
        ],
    }
    page = pages_from_docai(document, 800, 1000)[0]
    assert [l.text for l in page.lines] == ["Roll Number: 2410387", "Percentage: 88.20"]
    assert page.lines[0].words[2].conf == 0.71
    assert page.lines[1].words[1].bbox == (0.21, 0.2, 0.28, 0.22)


def test_deskew_levels_a_rotated_scan():
    img = Image.new("L", (800, 600), 255)
    d = ImageDraw.Draw(img)
    for y in range(150, 450, 30):
        d.rectangle((100, y, 700, y + 8), fill=0)
    rotated = img.rotate(4, expand=False, fillcolor=255)

    def row_spread(im):
        arr = np.array(im) < 128
        rows = arr.sum(axis=1)
        return (rows > arr.shape[1] * 0.5).sum()

    assert row_spread(deskew(rotated)) > row_spread(rotated)


def test_blank_image_is_left_alone():
    assert deskew(Image.new("RGB", (100, 100), "white")).size == (100, 100)


def test_sniff_and_text_layer_threshold():
    assert sniff(b"%PDF-1.4") == "application/pdf"
    assert sniff(b"\xff\xd8\xff\xe0") == "image/jpeg"
    assert sniff(b"GIF89a") is None
    assert pdf_text_pages(text_pdf(["only one line"])) is None
