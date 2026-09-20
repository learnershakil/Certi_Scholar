FROM python:3.12-slim

# The one non-obvious part of this image: the OCR engine is a system binary, not a pip package.
# - tesseract-ocr + tesseract-ocr-eng: the engine and English model used by pytesseract.
# - libgl1/libglib2.0-0 are NOT needed because we use opencv-python-headless.
# Add language packs (e.g. tesseract-ocr-hin) here when an extraction profile needs them.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

RUN useradd --system --uid 10001 ocr
USER ocr
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"
# One process per CPU; scale horizontally with replicas rather than threads (Tesseract is CPU-bound).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${OCR_WORKERS:-2}"]
