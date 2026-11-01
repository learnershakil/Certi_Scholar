# Architecture (Track J)

```
 Browser ──► web (Next.js 16, :3000) ──/api rewrite──► api (Express 5 + TS, :4000) ──► MongoDB
                                                        │  enqueue only                  ▲
                                                        ▼                                │
                                                      Redis (BullMQ) ◄── worker-ocr ──► ocr (FastAPI + Tesseract, :8000)
                                                                    ◄── worker (analysis · verification · evaluation · maintenance)
 api ──► ClamAV (clamd INSTREAM) at upload, before anything is stored
```

## Product flow

1. **Student uploads** (`POST /documents`). The type is checked from the file's content (magic bytes), PDFs with scripts are refused, the file is scanned by ClamAV, then encrypted (AES-256-GCM) onto a private volume. Response `202`; the OCR job is queued. Nothing slow runs inside a request.
2. **`ocr` queue** → Python service. Digital PDFs use their text layer; scans are deskewed (OpenCV) and read by Tesseract or Google Document AI behind the same interface.
3. **`analysis` queue** → classification (keyword coverage with board synonyms, ambiguous ties refused; the type a student chose at upload settles an inconclusive result, never a confident one) → extraction: a document type can have several formats (marksheet: `standard`, `icse-class-x`), every active format is tried and the one finding the most required fields wins (regex per field, one capture group; value mapped back to OCR words for a bounding box and the minimum word confidence; an unreadable line inside a marks table becomes an empty row for the officer) → consistency checks (recompute totals and percentage, marks in words against figures, check digits, certificate age).
4. Any field below its threshold, missing, or failing its type check is `needs_review`. The document goes to the **review queue**. A verifier claims the case (case assignment), sees the image with field overlays, and confirms or corrects values with a reason. Corrections re-run the consistency checks.
5. **Verification** through the configured adapter (`registry` REST, or `simulated` outside production), with manual officer verification as the fallback in every configuration.
6. **Student applies** with their documents. The `evaluation` queue builds facts from reviewed values only, evaluates the scholarship's active rule version, and stores a recommendation listing each condition, the fact value and its source, and what has been established about each document. Re-evaluation is triggered automatically when review or verification completes.
7. **Scholarship officer** reviews and records the award decision. Award lists export as CSV.

## Modules

| Module | Code |
|---|---|
| M1 Secure intake | `routes/documents.ts` (POST), `lib/fileType.ts`, `lib/scanner.ts`, `lib/storage.ts`, `lib/crypto.ts` |
| M2 OCR | `services/ocr` (providers: `tesseract.py`, `google_docai.py`, PDF text layer), `ocr/client.ts` |
| M3 Classification · M4 Extraction | `domain/extraction.ts`, profiles in `seedData.ts` and the admin API |
| M5 Review & correction | `routes/documents.ts` (claim, fields, review), `components/DocumentViewer.tsx`, `FieldList.tsx` |
| M6 Consistency | `domain/consistency.ts` |
| M7 Verification adapter | `verification/providers.ts`, `services/verification.ts` |
| M8 Rule engine | `domain/rules.ts` (pure; no I/O; reusable), `domain/facts.ts` |
| M9 Recommendation | `services/recommendation.ts` |
| M10 Timeline, audit, reports | `lib/events.ts`, `routes/reports.ts`, `routes/admin.ts` |

## Data model (MongoDB)

`Document` (per-stage status array, verification summary, retention date), `DocumentType`, `ExtractionProfile` (versioned), `ExtractedField` (with embedded `ConfidenceScore`), `Correction`, `ConsistencyCheck`, `VerificationRequest`, `VerificationResult`, `Scholarship`, `ScholarshipRule` (versioned, root `RuleCondition` tree), `Application`, `Recommendation` (snapshot with rule version), `ProcessingTimeline`, `AuditEntry`, plus `DocumentAccessLog` (separate view log), `Notification`, `Settings`, `User`.

## Security

- Encryption at rest with a key id in every blob (rotation keeps old ids readable). Storage keys are random UUIDs, validated before any path is built.
- No direct file URLs. `POST /documents/:id/access-url` returns an HMAC-signed token valid for 120 s and bound to the requesting user; `GET /files/:token` also requires the session. Every view is written to `DocumentAccessLog`.
- Session: httpOnly, `SameSite=Strict` cookie (JWT, 8 h), re-checked against the user record on every request, so deactivation takes effect immediately.
- Access by role and by case: students see their own documents; verifiers see documents they have claimed; scholarship officers see documents attached to applications for scholarships they are assigned to; admins see all, and are logged.
- Production guards in `config.ts`: no inline queue, no signature-only scanner. The simulated verification provider is refused by both the settings API and the provider resolver when `NODE_ENV=production`.
- Retention: a daily BullMQ job deletes files, previews, OCR output and extracted fields after `retentionDays`, keeping the audit trail.

## Scaling and performance

- OCR workers run on their own queue and containers (`worker-ocr`, `ocr` replicas). Tesseract is CPU-bound: about 1–3 s per page per core. Four OCR workers handle roughly 1,500–4,000 pages per hour, against a target of 500 documents per hour.
- The analysis, evaluation and verification queues are I/O-light and never wait behind OCR.
- Indexes on `Document.owner/status/assignedTo/retainUntil`, `ExtractedField(document,key)`, timeline and audit by subject.

## Configuration

See `.env.example`. Thresholds, the verification provider, retention and extraction profiles are runtime settings in the admin UI (audited), not deployment configuration.
