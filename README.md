# CertiScholar

OCR-based document extraction, consistency assessment and explainable scholarship recommendations. This is the Track J build: Next.js, Node.js/TypeScript, MongoDB, BullMQ, and a Python OCR service.

> **The system extracts values and checks that a document agrees with itself. It never claims a document is genuine unless an authorised issuing authority has confirmed it**, either through a configured adapter or by an officer recording a direct confirmation. See [docs/what-the-system-establishes.md](docs/what-the-system-establishes.md).

## Repository layout

```
apps/api         Express 5 + TypeScript API and BullMQ workers (M1, M3–M10)
apps/web         Next.js 16 frontend (review viewer, rule builder, reports, admin)
services/ocr     FastAPI OCR service: Tesseract, Google Document AI, PDF text layer (M2)
samples          Synthetic sample documents (3 formats), generator and labels
scripts          End-to-end run and accuracy benchmark against a live stack
docs             Architecture, OCR contract v1, committee guidance, benchmark report
```

## Run the stack

```bash
docker compose up -d --build
```

This starts mongo, redis, clamav, ocr (with Tesseract), api, worker, worker-ocr and web. ClamAV needs about 2 minutes to load its signatures on first start.

- App: http://localhost:3000. API: http://localhost:4000
- Demo accounts (seeded only when `NODE_ENV` is not production), password `Demo#Pass2026`:
  `student@`, `student2@`, `verifier@`, `officer@`, `admin@certischolar.local`
- Sample documents: `samples/documents/*.pdf|png`. Regenerate them with `python samples/generate.py`.

### Walkthrough

1. **Student**: upload `marksheet.png`, `income_certificate.pdf` and `identity.pdf`. Watch the stages run, then open a document to see the extracted fields over the image.
2. **Verifier**: in the Review queue, claim a case. Low-confidence fields are flagged in red; click one to highlight its region on the image. Confirm or correct it (a reason is required), complete the review, request verification (labelled **SIMULATED** in dev), and record a manual confirmation from the issuing authority.
3. **Student**: apply for *Merit-cum-Means Scholarship 2026* with the three documents.
4. **Officer**: open the application. You see every condition with its result, the source of each fact, and what has been established about each document. Award it, then export the award list from Reports.
5. **Admin**: under Scholarships & rules, edit a rule with the no-code builder, try it in the test harness, and publish a new version (no deployment). Settings covers thresholds, the provider and extraction profiles. The Audit page shows actions and every document view.

## Tests

| Suite | Command | Covers |
|---|---|---|
| API (Vitest, in-memory MongoDB) | `cd apps/api && npm test` | rule engine (operators, AND/OR, three-valued logic, both live rule sets), classification, extraction and confidence routing, consistency and recomputation, crypto and storage, pre-signed links, file validation and malware, production guards, full HTTP flow (intake → OCR failure and retry → review → correction audit → verification → recommendation → decision → timeline → reports → retention), admin rules, settings, profiles and users |
| OCR service (pytest) | `cd services/ocr && pip install -r requirements-dev.txt && python -m pytest` | contract v1 shape, versioning, error codes and retryability, PDF text layer with aligned boxes, Tesseract and Document AI mapping, deskew |
| Web (Vitest + Testing Library) | `cd apps/web && npm test` | bounding-box overlay, review and correction UI, rule builder, explanation tree, stage tracker, API client |
| End-to-end (live stack) | `node scripts/e2e.mjs` | the full product flow over HTTP against Docker, the 60 s single-document limit and the 500/hour throughput target |
| Accuracy benchmark | `node scripts/benchmark.mjs [labels.json] [dir]` | per-field accuracy and silent-error count; writes `docs/benchmark-report.md` |

The API tests download a MongoDB binary on first run. On Windows set `MONGOMS_DOWNLOAD_DIR` to a short path (the test setup defaults to `~/.cache/mongodb-binaries`).

## Local development without Docker

```bash
cd services/ocr && uvicorn app.main:app --port 8000      # Tesseract on PATH for scans; digital PDFs need none
cd apps/api && QUEUE_DRIVER=inline MALWARE_SCANNER=signature npm run seed && npm run dev
cd apps/web && npm run dev
```

`QUEUE_DRIVER=inline` runs jobs in-process after the response is sent, for development only. The config refuses it when `NODE_ENV=production`.

## API (v1)

`/api/v1/auth/{login,logout,me}` · `/documents` (POST upload, GET list) · `/documents/review-queue` · `/documents/:id` · `/documents/:id/status` · `/documents/:id/fields` (PATCH `/:key` corrects, POST `/:key/confirm` confirms) · `/documents/:id/{claim,type,reprocess,review/complete,access-url,verify,verify/manual,timeline,corrections,access-log}` · `/files/:token` · `/scholarships` · `/scholarships/facts` · `/scholarships/rules` · `/scholarships/rules/test` · `/scholarships/:id/rules` · `/applications` · `/applications/:id/{recommendation,decision,timeline}` · `/reports/summary` · `/reports/awards.csv` · `/admin/{settings,users,profiles,document-types,audit,access-log,health}`

Errors always use the shape `{ "error": { "code", "message", "details?" } }`.

## Not included

- **The 200-document labelled acceptance set** is supplied by the client. `scripts/benchmark.mjs` runs against it unchanged, given a labels file in the format of `samples/labels.json`.
- **Live authority integrations** (university registries, examination boards, DigiLocker). These depend on agreements with each issuer. The generic `RegistryProvider` REST adapter and the manual-verification fallback are in place.
- **Email/SMS delivery and SSO.** Notifications are stored in-app and passed to a channel hook in `lib/events.ts`. Login is local accounts behind the `authenticate` middleware, where an OIDC provider plugs in.

More: [architecture](docs/architecture.md) · [OCR contract v1](docs/ocr-contract-v1.md)
