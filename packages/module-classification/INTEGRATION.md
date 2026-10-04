# M3 Document Classification: integration note for M2, M4, M5 (and M10)

**Package:** `@repo/module-classification` (`packages/module-classification`)
**Contract version:** `"1"` (changes will be additive; treat enum-like fields as open sets)

M3 reads OCR text, decides what kind of document it is, and routes it onward. It never guesses: weak,
ambiguous or look-alike documents go to human review.

> **What M3 does and does not establish.** Classification says what *type* of document the text resembles.
> It says nothing about whether the document is genuine. Do not label M3 output "verified" anywhere in the UI.

---

## 0. Prerequisites for running M3 locally

M3 needs **MongoDB** and **Redis**. The easiest way is **Docker Desktop** (install it and make sure it is
running). Everything else is already in the repo:

```sh
cd packages/module-classification
cp .env.example .env            # then edit if needed, see below
docker compose up -d            # starts MongoDB (host port 27017) and Redis (6379)
bun install                     # from the repo root, once
bun run dev                     # M3 on http://localhost:4003
```

Also required: **Bun** and **Node 24+**.

- **No Docker?** You can use any MongoDB and Redis you already run. Just set `MONGO_URL` and `REDIS_URL`
  in `.env` and skip `docker compose`.
- **MongoDB already installed on your machine (common on Windows)?** It may already be using port 27017,
  and connections could silently reach the wrong database. Put `MONGO_PORT=27018` and
  `MONGO_URL=mongodb://localhost:27018/certischolar` in your `.env` before running `docker compose up -d`.
- **Modules only talk through Redis.** For two modules to exchange jobs they must use the **same Redis**.
  Each person's local Docker Redis is private to their own machine, so test integration on one machine or
  agree a shared Redis (decision 2 in section 8).
- `bun run test` needs no Docker. `bun run test:integration` does (it uses a separate `certischolar_test`
  database and Redis database 15, never your dev data).

---

## 1. How the modules connect

```
M2 (OCR)  --classification-->  M3  --extraction-->  M4 (extraction)
                                 \--review-------->  M5 (review)
every module  ------------ timeline ------------->  M10
```

All hand-offs are BullMQ queues on the **same Redis**. Queue names (from `QUEUES` in the package):

| Queue | Producer | Consumer | Payload |
|---|---|---|---|
| `classification` | M2 | M3 | `OcrCompletedEvent` |
| `extraction` | M3 | M4 | `ClassificationCompletedEvent` (`status: "classified"` only) |
| `review` | M3 | M5 | `ClassificationCompletedEvent` (`status: "needs_review"` only) |
| `timeline` | any module | M10 | `TimelineEvent` |

`documentId` is a **string** and must be the same ID in every module.

---

## 2. For M2 (OCR): sending documents to M3

Payload (validated with zod, see `src/contracts.ts`):

```ts
{
  version: "1",
  documentId: string,          // non-empty
  text: string,                // full OCR text
  pages?: { page: number; text: string; meanConfidence?: number /* 0..1 */ }[]
}
```

Use the shared helper so the payload is validated and the retry settings are identical everywhere:

```ts
import {
  createRedis,
  createClassificationQueue,
  enqueueOcrCompleted,
} from "@repo/module-classification";

const connection = createRedis(process.env.REDIS_URL!);
const queue = createClassificationQueue(connection);
await enqueueOcrCompleted(queue, { version: "1", documentId, text });
```

Behaviour you can rely on:

- Job options: 3 attempts, exponential backoff (1 s base), completed jobs removed, **failed jobs kept**.
- An **invalid payload fails immediately** (no retries) and appears in the `classification` failed set.
  `enqueueOcrCompleted` throws a `ZodError` before anything reaches Redis, so catch it.
- A job queued while M3 is down is processed when M3 restarts.
- Re-sending the same `documentId` is safe: M3 updates one row per document (idempotent).

**Retry hook (action for M2):** `POST /documents/:id/classify` can only re-run a document if it can fetch
the OCR text. Implement `OcrTextProvider { getText(documentId): Promise<string | null> }` and pass it to
`createClassificationModule({ ocrTextProvider })`. Until then, retries must send `{ "text": "..." }` in the body.

---

## 3. For M4 (extraction): what you receive

You get one job per document on `extraction`, only when M3 is confident.

```ts
{
  version: "1",
  documentId: string,
  status: "classified",
  source: "auto" | "manual",          // "manual" = a reviewer chose the type
  documentTypeCode: string,           // "MARKSHEET" | "ID_AADHAAR" | "INCOME_CERT" | admin-added codes
  extractionProfileId: string | null, // null until an admin links a profile to the type
  confidence: number,                 // 0..1
  candidates: { code: string; score: number }[],
  evidence: string[],                 // matched terms, for explainability
  reason: null,
  classifierVersion: string
}
```

- Job name `classification-completed`, job id `extraction-<documentId>`, 3 attempts, 2 s exponential backoff.
- **Treat the message as a notification, not the source of truth.** Before acting, call
  `GET /documents/:id/classification` and use that result. M3 replaces a *waiting* job when the outcome
  changes, but cannot remove a job you have already started.
- **Action for M4:** agree the `extractionProfileId` format and who sets it on each type
  (`PUT /document-types/:code`). Until it is set, the value is `null`.

---

## 4. For M5 (review): what you receive and how to override

Documents M3 would not auto-classify arrive on `review`: same shape as above, but `status: "needs_review"`,
`documentTypeCode: null`, and a **`reason`**:

| `reason` | Meaning |
|---|---|
| `empty_text` | OCR returned no text |
| `no_document_types` | No active document types configured |
| `low_confidence` | Best score below the type's `minConfidence` |
| `ambiguous` | Top two types too close to call |
| `no_anchor` | Generic words matched but no defining term for the type |
| `excluded_term` | A look-alike marker appeared (e.g. "application form", "affidavit") |

Do not hard-code this list; more reasons may be added. `candidates` and `evidence` show what M3 saw
(entries like `excluded: affidavit` explain an exclusion).

**Reviewer decision:** `PATCH /documents/:id/classification`

```json
{ "documentTypeCode": "INCOME_CERT", "actorId": "<reviewer id>", "reason": "optional note" }
```

M3 stores who and why, emits a timeline event, removes the stale `review` job, and publishes a
`source: "manual"` result to `extraction`. A later automatic reprocess will **not** overwrite a manual
decision unless `force: true` is sent. `actorId` is currently taken from the body; it must come from the
authenticated user once auth exists.

---

## 5. For M10 (timeline) and everyone: timeline events

Every module should emit this shape to the `timeline` queue (job name `timeline-event`), with its own `stage`:

```ts
{
  version: "1",
  documentId: string,
  stage: string,                                   // M3 uses "classification"
  status: "started" | "completed" | "needs_review" | "failed",
  actor: { type: "system" | "user"; id: string },
  timestamp: string,                               // ISO 8601
  meta?: Record<string, unknown>
}
```

M3 emits `started`, then `completed` or `needs_review` (meta: `documentTypeCode`, `confidence`, `reason`),
or `failed` (meta: `error`). A manual override emits `completed` with `actor.type: "user"` and
`meta.manualOverride: true`. A reprocess skipped because of a manual decision emits nothing.

---

## 6. HTTP endpoints (M3 server, default port 4003)

| Method | Path | Purpose |
|---|---|---|
| POST | `/internal/classify` | Classify directly with an `OcrCompletedEvent` body (testing) |
| GET | `/documents/:id/classification` | Latest result |
| POST | `/documents/:id/classify` | Retry. Body `{ text?, force? }` |
| PATCH | `/documents/:id/classification` | Reviewer override |
| GET, POST | `/document-types` | List / create |
| GET, PUT | `/document-types/:code` | Read / update (`keywords`, `anchorTerms`, `excludeTerms`, `minConfidence`, `extractionProfileId`, `active`) |
| GET | `/health` | Liveness (dev server) |

Errors: `400 validation_error` (with `issues`) or `invalid_json`, `404`, `409`, `422 no_ocr_text`, `500`.
There is **no authentication** on these routes yet; role checks belong in the gateway.

---

## 7. Test the connection together (10 minutes)

1. Follow section 0 (Docker running, `.env` created, `docker compose up -d`, then `bun run dev`).
2. M2 enqueues one document with `enqueueOcrCompleted` (or: `bun run enqueue --id demo-1 --file <txt>`).
3. `GET http://localhost:4003/documents/demo-1/classification` shows the result.
4. `redis-cli llen bull:extraction:wait` (classified) or `bull:review:wait` (needs review) shows the hand-off.

---

## 8. Decisions needed at the meeting

1. **Queue names and payloads** in section 1 to 5: agreed as is?
2. **Redis:** one shared instance per environment? Which database number?
3. **Deployment:** does M3 run as its own service (port 4003) or get mounted into a shared API gateway
   (`createClassificationModule()` supports both)?
4. **`extractionProfileId`:** format, and who sets it on each document type.
5. **Sensitive data:** queue payloads contain full OCR text of identity and income documents, and failed
   jobs are kept in Redis. Agree a retention rule for failed jobs and an encryption/access approach.
6. **`documentId`:** confirm one string ID shared by all modules.
7. **Auth:** who adds role checks, and when does `actorId` start coming from the logged-in user?
