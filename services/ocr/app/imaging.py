"""Document loading and image clean-up. Word boxes are always relative to the image returned here,
so the preview the reviewer sees and the boxes drawn on it line up exactly."""

import io

import cv2
import numpy as np
import pdfplumber
import pypdfium2 as pdfium
from PIL import Image, ImageOps

from app.contract import OcrError, Page, Word, make_line

RENDER_DPI = 200
MAX_PAGES = 5


def sniff(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None


def deskew(image: Image.Image) -> Image.Image:
    """Greyscale, estimate skew from the text mass and rotate it level. Small angles only — scans, not photos."""
    grey = np.array(image.convert("L"))
    _, binary = cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    coords = np.column_stack(np.where(binary > 0))
    if len(coords) < 50:
        return Image.fromarray(grey)
    angle = cv2.minAreaRect(coords[:, ::-1].astype(np.float32))[-1]
    if angle > 45:
        angle -= 90
    if abs(angle) < 0.3 or abs(angle) > 15:
        return Image.fromarray(grey)
    h, w = grey.shape
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    rotated = cv2.warpAffine(grey, matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(rotated)


def load_images(data: bytes, mime: str) -> list[Image.Image]:
    try:
        if mime == "application/pdf":
            pdf = pdfium.PdfDocument(data)
            return [pdf[i].render(scale=RENDER_DPI / 72).to_pil() for i in range(min(len(pdf), MAX_PAGES))]
        return [ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")]
    except Exception as exc:  # corrupt or truncated files are not worth retrying
        raise OcrError(422, "unreadable_document", f"Document could not be decoded: {exc}", retryable=False) from exc


def pdf_text_pages(data: bytes) -> list[Page] | None:
    """Digitally issued PDFs carry an exact text layer; use it instead of OCR. Returns None for scanned PDFs."""
    pages: list[Page] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for i, p in enumerate(pdf.pages[:MAX_PAGES]):
            words = p.extract_words(keep_blank_chars=False, use_text_flow=False)
            rows: dict[int, list[dict]] = {}
            for w in words:
                key = next((k for k in rows if abs(k - w["top"]) < 3), round(w["top"]))
                rows.setdefault(key, []).append(w)
            lines = [
                make_line([
                    Word(text=w["text"], conf=1.0, bbox=(w["x0"] / p.width, w["top"] / p.height, w["x1"] / p.width, w["bottom"] / p.height))
                    for w in sorted(row, key=lambda w: w["x0"])
                ])
                for _, row in sorted(rows.items())
            ]
            pages.append(Page(index=i, width=int(p.width), height=int(p.height), lines=lines))
    return pages if sum(len(p.lines) for p in pages) >= 3 else None


def to_png(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
