# @repo/module-classification (M3)

Decides what kind of document OCR text came from (marksheet, ID, income certificate, ...) and
which M4 extraction profile should handle it. It never guesses: weak or ambiguous matches go to
`needs_review`.

This says nothing about whether a document is genuine. It is a type assessment only.

## Run it

```sh
bun install                                   # from the repo root
cp packages/module-classification/.env.example packages/module-classification/.env
cd packages/module-classification
bun run dev                                   # Express on :4003 (needs MongoDB; Redis optional)
bun run test
```

With `REDIS_URL` unset the module runs HTTP-only and just logs its results.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/internal/classify` | Body is an `OcrCompletedEvent`. Synchronous. For testing before M2 exists. |
| GET | `/documents/:id/classification` | Latest result |
| POST | `/documents/:id/classify` | Retry. Body `{ text?, force? }`. Idempotent (upsert by `documentId`). |
| PATCH | `/documents/:id/classification` | Reviewer override `{ documentTypeCode, actorId, reason? }` |
| GET/POST | `/document-types` | List / create |
| GET/PUT | `/document-types/:code` | Read / update |

```sh
curl -X POST localhost:4003/internal/classify -H 'content-type: application/json' \
  -d '{"version":"1","documentId":"doc1","text":"STATEMENT OF MARKS Roll No 12 Marks Obtained 441 Percentage 88.2"}'
```

## Wiring into a host app later

```ts
import { createClassificationModule, createRedis } from "@repo/module-classification";

const m3 = createClassificationModule({ connection: createRedis(process.env.REDIS_URL!) });
app.use(m3.router);
m3.startWorker();
```

## Queues (confirm with M2, M4, M5 owners)

| Queue | Direction | Payload |
|---|---|---|
| `classification` | M2 -> M3 | `OcrCompletedEvent` |
| `extraction` | M3 -> M4 | `ClassificationCompletedEvent` with `status: "classified"` |
| `review` | M3 -> M5 | `ClassificationCompletedEvent` with `status: "needs_review"` |
| `timeline` | any -> M10 | `TimelineEvent` |

Contracts live in `src/contracts.ts` (zod). When a shared contracts package exists, move that file
there unchanged.

## Behaviour worth knowing

- One `classifications` row per `documentId`, so reprocessing never duplicates.
- A manual reviewer decision is not overwritten by a reprocess unless `force: true`.
- Timeline emit failures are logged and never fail classification.
- Regex patterns from admins are length-limited, validated on save, and ignored if invalid at runtime.
  Avoid catastrophic-backtracking patterns; only admins can create them.
- No auth is applied here. Add role checks as a hook in the gateway.
