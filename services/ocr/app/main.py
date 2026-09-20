import base64
import logging
import os
import time

from fastapi import FastAPI, File, Header, Request, UploadFile
from fastapi.responses import JSONResponse

from app.contract import CONTRACT_VERSION, OcrError, OcrResponse, Preview
from app.imaging import deskew, load_images, pdf_text_pages, sniff, to_png
from app.providers.base import OcrProvider
from app.providers.google_docai import GoogleDocumentAIProvider
from app.providers.tesseract import TesseractProvider

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("ocr")

MAX_BYTES = int(os.getenv("OCR_MAX_BYTES", str(10 * 1024 * 1024)))
PROVIDERS: dict[str, OcrProvider] = {"tesseract": TesseractProvider(), "google_docai": GoogleDocumentAIProvider()}

app = FastAPI(title="CertiScholar OCR service", version=CONTRACT_VERSION)


def active_provider() -> OcrProvider:
    return PROVIDERS[os.getenv("OCR_PROVIDER", "tesseract")]


@app.exception_handler(OcrError)
async def ocr_error(_: Request, exc: OcrError):
    return JSONResponse(status_code=exc.status, content={"error": exc.body.model_dump()})


@app.get("/health")
def health():
    provider = active_provider()
    ok = provider.available()
    return JSONResponse(
        status_code=200 if ok else 503,
        content={"status": "ok" if ok else "degraded", "contractVersion": CONTRACT_VERSION, "provider": provider.name, "providers": [n for n, p in PROVIDERS.items() if p.available()]},
    )


@app.post("/v1/ocr", response_model=OcrResponse)
def ocr(file: UploadFile = File(...), x_contract_version: str | None = Header(default=None)):
    """Synchronous by design: the Node worker owns queueing, retries and timeouts; this service only reads documents."""
    if x_contract_version != CONTRACT_VERSION:
        raise OcrError(400, "contract_mismatch", f"Service implements contract {CONTRACT_VERSION}, caller sent {x_contract_version}", retryable=False)
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise OcrError(413, "too_large", "Document exceeds the size limit", retryable=False)
    mime = sniff(data)
    if mime is None:
        raise OcrError(415, "unsupported_type", "Only PDF, PNG and JPEG are supported", retryable=False)

    started = time.perf_counter()
    images = load_images(data, mime)
    if mime == "application/pdf" and (text_pages := pdf_text_pages(data)):
        provider_name, pages = "pdf_text_layer", text_pages
    else:
        provider = active_provider()
        if not provider.available():
            raise OcrError(503, "ocr_unavailable", f"OCR provider {provider.name} is not available", retryable=True)
        images = [deskew(img) for img in images]
        provider_name, pages = provider.name, [provider.recognise(img, i) for i, img in enumerate(images)]

    duration = int((time.perf_counter() - started) * 1000)
    log.info("ocr done provider=%s pages=%d ms=%d", provider_name, len(pages), duration)
    return OcrResponse(
        provider=provider_name,
        durationMs=duration,
        pages=pages,
        preview=Preview(base64=base64.b64encode(to_png(images[0])).decode()),
    )
