"""OCR service contract, version 1. See docs/ocr-contract-v1.md.

Breaking changes require a new version; the caller sends X-Contract-Version and the service
refuses versions it does not implement rather than returning a shape the caller cannot read.
"""

from typing import Literal

from pydantic import BaseModel, Field

CONTRACT_VERSION = "1"

BBox = tuple[float, float, float, float]  # normalised x0, y0, x1, y1 in [0, 1]


class Word(BaseModel):
    text: str
    conf: float = Field(ge=0, le=1)
    bbox: BBox


class Line(BaseModel):
    text: str
    words: list[Word]


class Page(BaseModel):
    index: int
    width: int
    height: int
    lines: list[Line]


class Preview(BaseModel):
    mime: Literal["image/png"] = "image/png"
    base64: str


class OcrResponse(BaseModel):
    contractVersion: Literal["1"] = CONTRACT_VERSION
    provider: str
    durationMs: int
    pages: list[Page]
    preview: Preview | None


class ErrorBody(BaseModel):
    code: str
    message: str
    retryable: bool


class OcrError(Exception):
    """Raised by providers and loaders; mapped to an HTTP error with an explicit retryable flag."""

    def __init__(self, status: int, code: str, message: str, retryable: bool):
        super().__init__(message)
        self.status = status
        self.body = ErrorBody(code=code, message=message, retryable=retryable)


def make_line(words: list[Word]) -> Line:
    return Line(text=" ".join(w.text for w in words), words=words)
