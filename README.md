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
node scripts/init-env.mjs
```

```bash
docker compose up -d --build
```

The first command creates `.env` with random secrets and a random demo password, which it prints. The second starts mongo, redis, clamav, ocr (with Tesseract), api, worker, worker-ocr and web. ClamAV needs about 2 minutes to load its signatures on first start.

- App: http://localhost:3000. API: http://localhost:4000
- Demo accounts (created only when `SEED_DEMO=true`, never in production), password = `SEED_DEMO_PASSWORD` in `.env`:
  `student@`, `student2@`, `verifier@`, `officer@`, `admin@certischolar.local`
- Sample documents: `samples/documents/*.pdf|png`. Regenerate them with `python samples/generate.py`.

### Walkthrough

1. **Student**: upload `marksheet.png`, `income_certificate.pdf` and `identity.pdf` (optionally choosing the type; "Detect automatically" is the default). ICSE Class X marksheets are read with their own format profile. Watch the stages run, then open a document to see the extracted fields over the image.
2. **Verifier**: in the Review queue, claim a case. Low-confidence fields are flagged in red; click one to highlight its region on the image. Confirm or correct it (a reason is required), complete the review, request verification (labelled **SIMULATED** in dev), and record a manual confirmation from the issuing authority.
3. **Student**: apply for *Merit-cum-Means Scholarship 2026* with the three documents.
4. **Officer**: open the application. You see every condition with its result, the source of each fact, and what has been established about each document. Award it, then export the award list from Reports.
5. **Admin**: under Scholarships & rules, edit a rule with the no-code builder, try it in the test harness, and publish a new version (no deployment). Settings covers thresholds, the provider and extraction profiles. The Audit page shows actions and every document view.

## Configuration: where every value lives

Nothing environment-specific is written in the code. Each kind of value has one home:

| Kind of value | Where | How to change it |
|---|---|---|
| Secrets: `JWT_SECRET`, `PRESIGN_SECRET`, `STORAGE_KEY`, `REGISTRY_API_KEY` | `.env` (never committed) | `node scripts/init-env.mjs` generates them; edit `.env` and restart. **Never change `STORAGE_KEY` on a system with documents**: they would no longer open |
| Runtime settings: session length, job retries and backoff, worker concurrency, retention schedule, list size, upload limit, OCR timeout | `.env`, documented in `.env.example` | Edit `.env`, then `docker compose up -d`. The API validates every value at startup and names any bad one |
| Demo accounts and their password | `apps/api/seed/demo-users.json` + `SEED_DEMO`, `SEED_DEMO_PASSWORD` in `.env` | Refused when `NODE_ENV=production` |
| Login-page demo shortcuts | `NEXT_PUBLIC_DEMO_ACCOUNTS` in `.env` (`email:role,…`) | Rebuild the web image. They fill the email and role only; no password is ever in the web app |
| Reference data: document types, extraction profiles, scholarships and first rule sets | JSON files in `apps/api/seed/` | Loaded on first start, and only what's missing is created, so later edits made in the app are kept. After that, change them in the app |
| Tuning: confidence and classification thresholds, classification margin, percentage tolerance, unreadable-line confidence, certificate validity, plausible age range, retention period, verification provider | Database (`Settings`) | **Admin → Settings & profiles**, no restart; every change is audited |
| Extraction profile patterns and thresholds | Database (`ExtractionProfile`, versioned) | **Admin → Settings & profiles** → Publish new version |
| Eligibility rules | Database (`ScholarshipRule`, versioned) | **Admin → Scholarships & rules**, tested in the harness before publishing |
| Product name, sign-in page wording, role names, rule-fact labels and descriptions | Database (`Settings`), defaults in `apps/api/seed/settings.json`, served publicly (branding and role names only) at `GET /api/v1/branding` | **Admin → Settings & profiles → Wording**; shows on the next page load, no rebuild |
| Demo people and their emails | `apps/api/seed/demo-users.json` | Edit the file; scripts and tests look emails up there |
| Document types shown in dropdowns and labels | Database (`DocumentType`), served at `GET /api/v1/document-types` | Add to `seed/document-types.json` for new installs; the web app reads the list from the API |

What stays in code on purpose: the role keys, status keys and rule operators (their display names are configurable). These are the system's vocabulary, which the code reasons about; changing them is a code change by design.

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
cd apps/api && QUEUE_DRIVER=inline MALWARE_SCANNER=signature npm run seed && npm run dev   # with the .env values exported
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
