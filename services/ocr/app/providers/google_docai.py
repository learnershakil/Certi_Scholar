import base64
import io
import os

import httpx
from PIL import Image

from app.contract import OcrError, Page, Word, make_line


class GoogleDocumentAIProvider:
    """Google Document AI (OCR processor) over REST. Credentials come from Application Default Credentials."""

    name = "google_docai"

    def __init__(self) -> None:
        self.project = os.getenv("GOOGLE_DOCAI_PROJECT", "")
        self.location = os.getenv("GOOGLE_DOCAI_LOCATION", "eu")
        self.processor = os.getenv("GOOGLE_DOCAI_PROCESSOR", "")

    def available(self) -> bool:
        return bool(self.project and self.processor)

    def _token(self) -> str:
        import google.auth
        import google.auth.transport.requests

        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        creds.refresh(google.auth.transport.requests.Request())
        return creds.token

    def recognise(self, image: Image.Image, index: int) -> Page:
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        url = (
            f"https://{self.location}-documentai.googleapis.com/v1/projects/{self.project}"
            f"/locations/{self.location}/processors/{self.processor}:process"
        )
        try:
            res = httpx.post(
                url,
                headers={"Authorization": f"Bearer {self._token()}"},
                json={"rawDocument": {"content": base64.b64encode(buf.getvalue()).decode(), "mimeType": "image/png"}},
                timeout=40,
            )
        except httpx.HTTPError as exc:
            raise OcrError(503, "provider_unreachable", str(exc), retryable=True) from exc
        if res.status_code >= 400:
            raise OcrError(503 if res.status_code >= 500 or res.status_code == 429 else 422, "provider_error", res.text[:300], retryable=res.status_code >= 500 or res.status_code == 429)
        pages = pages_from_docai(res.json()["document"], image.width, image.height)
        return pages[0].model_copy(update={"index": index})


def _span(layout: dict) -> tuple[int, int]:
    seg = layout.get("textAnchor", {}).get("textSegments", [{}])[0]
    return int(seg.get("startIndex", 0)), int(seg["endIndex"])


def _bbox(layout: dict) -> tuple[float, float, float, float]:
    vs = layout["boundingPoly"]["normalizedVertices"]
    xs, ys = [v.get("x", 0.0) for v in vs], [v.get("y", 0.0) for v in vs]
    return (min(xs), min(ys), max(xs), max(ys))


def pages_from_docai(document: dict, width: int, height: int) -> list[Page]:
    """Maps a Document AI `Document` to contract pages: tokens become words, lines group tokens by text span."""
    text = document.get("text", "")
    out: list[Page] = []
    for i, p in enumerate(document.get("pages", [])):
        tokens = []
        for t in p.get("tokens", []):
            s, e = _span(t["layout"])
            word = text[s:e].strip()
            if word:
                tokens.append((s, Word(text=word, conf=round(float(t["layout"].get("confidence", 0)), 3), bbox=_bbox(t["layout"]))))
        lines = []
        for ln in p.get("lines", []):
            s, e = _span(ln["layout"])
            words = [w for (ts, w) in tokens if s <= ts < e]
            if words:
                lines.append(make_line(words))
        out.append(Page(index=i, width=width, height=height, lines=lines))
    return out
