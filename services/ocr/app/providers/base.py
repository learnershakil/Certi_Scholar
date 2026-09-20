from typing import Protocol

from PIL import Image

from app.contract import Page


class OcrProvider(Protocol):
    """Every OCR backend implements this. Pages come back with normalised word boxes."""

    name: str

    def recognise(self, image: Image.Image, index: int) -> Page: ...

    def available(self) -> bool: ...
