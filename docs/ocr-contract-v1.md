# OCR service contract — version 1

The Node worker (`apps/api/src/ocr/client.ts`) and the Python service (`services/ocr`) communicate only through this contract. Both sides validate it: the service with Pydantic (`app/contract.py`), the caller with Zod (`ocrResultSchema`).

## Versioning

- The caller sends `X-Contract-Version: 1` on every request.
- The service rejects any other version with `400 contract_mismatch` (not retryable).
- Additive, optional fields may be added within v1. Renaming, removing or changing the meaning of a field requires v2, served side by side with v1 until every caller has moved.

## `POST /v1/ocr`

`multipart/form-data` with one part, `file` (PDF, PNG or JPEG, ≤ 10 MB, first 5 pages).

### 200 response

```json
{
  "contractVersion": "1",
  "provider": "tesseract | google_docai | pdf_text_layer",
  "durationMs": 1830,
  "pages": [
    {
      "index": 0,
      "width": 1654,
      "height": 2339,
      "lines": [
        {
          "text": "Percentage: 88.20",
          "words": [
            { "text": "Percentage:", "conf": 0.96, "bbox": [0.072, 0.512, 0.181, 0.524] },
            { "text": "88.20", "conf": 0.91, "bbox": [0.188, 0.512, 0.236, 0.524] }
          ]
        }
      ]
    }
  ],
  "preview": { "mime": "image/png", "base64": "iVBORw0..." }
}
```

- `conf` is the engine's word confidence normalised to 0–1. Text-layer PDFs report 1.0 because the text is exact, not recognised.
- `bbox` is `[x0, y0, x1, y1]` normalised to the page (0–1), relative to the `preview` image. The reviewer UI draws boxes as percentages of the preview, so they line up at any zoom.
- `preview` is the first page as the service saw it (rasterised PDF, or the deskewed scan).

### Error response

```json
{ "error": { "code": "ocr_unavailable", "message": "…", "retryable": true } }
```

| Status | code | retryable | Caller behaviour |
|---|---|---|---|
| 400 | `contract_mismatch` | no | Mark failed; deploy mismatch |
| 413 | `too_large` | no | Mark failed |
| 415 | `unsupported_type` | no | Mark failed |
| 422 | `unreadable_document` | no | Mark failed; ask student for a clearer copy |
| 503 | `ocr_unavailable`, `ocr_timeout`, `provider_unreachable`, `provider_error` | yes | BullMQ retries (3 attempts, exponential backoff) |

A network error, timeout (`OCR_TIMEOUT_MS`, default 45 s) or a response that fails schema validation is treated as retryable.

## Failure guarantees

- The OCR stage never deletes or alters the stored file. After the final failed attempt the document is `failed`, its `ocr` stage records the error and attempt count, and it appears in the review queue. `POST /documents/:id/reprocess {"from":"ocr"}` retries it from the stored file.
- Every later stage is idempotent: it clears its own previous output before writing, and officer corrections are re-applied after re-extraction.

## `GET /health`

`200 {"status":"ok","contractVersion":"1","provider":"tesseract","providers":["tesseract"]}` when the configured engine is usable, otherwise `503` with `status: "degraded"`. Used by the container health check and by the admin settings page.
