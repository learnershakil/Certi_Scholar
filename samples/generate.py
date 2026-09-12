"""Generates synthetic sample documents in the three supported formats (fictional people and issuers).

Each document is written twice: a digitally issued PDF (text layer, read without OCR) and a scanned-style
PNG (read by Tesseract). Usage: python samples/generate.py [output_dir]
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

SUBJECTS = [("English", 100, 88), ("Mathematics", 100, 92), ("Physics", 100, 85), ("Chemistry", 100, 81), ("Computer Science", 100, 95)]


def marksheet(printed_pct: str) -> list[tuple[str, ...]]:
    total = sum(s[2] for s in SUBJECTS)
    rows: list[tuple[str, ...]] = [
        ("STATE BOARD OF HIGHER SECONDARY EDUCATION",),
        ("STATEMENT OF MARKS",),
        ("",),
        ("Name of Candidate: ANANYA SHARMA",),
        ("Roll Number: 2410387",),
        ("Year of Examination: 2025",),
        ("",),
        ("SUBJECT", "MAX", "OBTAINED"),
    ]
    rows += [(n, str(m), str(o)) for n, m, o in SUBJECTS]
    rows += [("",), (f"Total Marks Obtained: {total} / 500",), (f"Percentage: {printed_pct}",), ("Result: PASS",)]
    return rows


DOCUMENTS = {
    "marksheet": marksheet("88.20"),
    "marksheet_inconsistent": marksheet("93.40"),
    "income_certificate": [
        ("OFFICE OF THE TAHSILDAR NORTH DISTRICT",),
        ("INCOME CERTIFICATE",),
        ("",),
        ("Certificate No: INC/2026/004512",),
        ("This is to certify that the annual family income of",),
        ("Name: ANANYA SHARMA",),
        ("from all sources is as stated below.",),
        ("Annual Family Income: Rs. 2,40,000",),
        ("Date of Issue: 15/06/2026",),
        ("Issuing Authority: Tahsildar North District",),
    ],
    "identity": [
        ("RESIDENT IDENTITY CARD",),
        ("",),
        ("Name: ANANYA SHARMA",),
        ("Date of Birth: 14/08/2007",),
        ("Gender: Female",),
        ("ID Number: 2345 6789 0124",),
    ],
}

COLUMNS = (0, 300, 380)  # x offsets (points) for table columns


def write_pdf(path: Path, rows) -> None:
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setFont("Helvetica", 12)
    y = 780
    for row in rows:
        for x, cell in zip(COLUMNS, row):
            c.drawString(60 + x, y, cell)
        y -= 22
    c.save()


def write_png(path: Path, rows) -> None:
    scale = 200 / 72
    img = Image.new("RGB", (int(A4[0] * scale), int(A4[1] * scale)), "white")
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=34)
    y = 120
    for row in rows:
        for x, cell in zip(COLUMNS, row):
            draw.text((int((60 + x) * scale), y), cell, fill="black", font=font)
        y += 62
    img.save(path)


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for name, rows in DOCUMENTS.items():
        write_pdf(out / f"{name}.pdf", rows)
        write_png(out / f"{name}.png", rows)
        print(f"wrote {name}.pdf, {name}.png")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "documents")
