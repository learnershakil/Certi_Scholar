import shutil
from collections import OrderedDict

import pytesseract
from PIL import Image

from app.contract import OcrError, Page, Word, make_line


class TesseractProvider:
    """Self-hosted Tesseract. Words are grouped back into lines by Tesseract's own block/paragraph/line ids."""

    name = "tesseract"

    def __init__(self, lang: str = "eng", timeout_s: int = 40):
        self.lang = lang
        self.timeout_s = timeout_s

    def available(self) -> bool:
        return shutil.which(pytesseract.pytesseract.tesseract_cmd) is not None

    def recognise(self, image: Image.Image, index: int) -> Page:
        try:
            data = pytesseract.image_to_data(
                image, lang=self.lang, config="--oem 1 --psm 6", output_type=pytesseract.Output.DICT, timeout=self.timeout_s
            )
        except RuntimeError as exc:  # pytesseract raises RuntimeError on timeout
            raise OcrError(503, "ocr_timeout", str(exc), retryable=True) from exc
        except pytesseract.TesseractNotFoundError as exc:
            raise OcrError(503, "ocr_unavailable", "Tesseract binary not found", retryable=True) from exc
        return page_from_tesseract(data, image.width, image.height, index)


def page_from_tesseract(data: dict, width: int, height: int, index: int) -> Page:
    lines: "OrderedDict[tuple[int, int, int], list[Word]]" = OrderedDict()
    for i, text in enumerate(data["text"]):
        text = (text or "").strip()
        conf = float(data["conf"][i])
        if not text or conf < 0:  # -1 marks non-word layout boxes
            continue
        x, y, w, h = (data[k][i] for k in ("left", "top", "width", "height"))
        word = Word(text=text, conf=round(conf / 100, 3), bbox=(x / width, y / height, (x + w) / width, (y + h) / height))
        lines.setdefault((data["block_num"][i], data["par_num"][i], data["line_num"][i]), []).append(word)
    return Page(index=index, width=width, height=height, lines=[make_line(ws) for ws in lines.values()])
