# M1 — Secure Document Intake: Implementation Plan

## 1. Repository Findings
The repository `c:/certiScholar` is entirely empty. No existing frameworks, CI/CD, or conventions are present. We will establish a clean, production-grade monorepo architecture using `npm workspaces` (or `pnpm` depending on preference, we will use `npm` for standard compatibility) suitable for the "Track J" project.

## 2. Architecture Overview
We will use a monorepo containing:
- `apps/frontend`: A Next.js (React + TypeScript + Tailwind CSS) application for the student and verification officer UI.
- `apps/backend`: A Node.js (Express + TypeScript) backend service for API, document validation, and database operations.
- `apps/worker`: A Node.js (TypeScript) background worker using BullMQ to handle malware scanning and M1 -> M2 queue handoffs.
- `packages/shared`: Shared TypeScript types, schemas (Zod), and utility functions.

## 3. Database Design (MongoDB)
**Collection: `documents`**
- `_id`: ObjectId
- `documentId`: String (UUID, external facing)
- `ownerId`: String (User ID of uploader)
- `applicationId`: String (Optional, for case association)
- `originalFilename`: String
- `storageKey`: String (Generated, unguessable)
- `mimeType`: String
- `sizeBytes`: Number
- `checksum`: String (SHA-256 for idempotency and integrity)
- `requestedType`: String (e.g., 'identity', 'income', 'marksheet')
- `status`: Enum (new, validating, quarantined, scanning, rejected, infected, scan-error, clean, queued, processing, failed, completed, deleted, missing)
- `scanDetails`: Object (scanner name, version, timestamp, error details if any)
- `retentionDetails`: Object (expiresAt Date)
- `createdAt`, `updatedAt`: Timestamps

**Collection: `audit_logs`**
- `_id`: ObjectId
- `documentId`: String
- `actorId`: String
- `action`: String (UPLOADED, SCANNED, ACCESS_GRANTED, ACCESS_DENIED, DELETED)
- `metadata`: Object
- `createdAt`: Timestamp

## 4. Storage Strategy
- Interface: `StorageProvider` (methods: `upload`, `delete`, `getSignedUrl`, `exists`).
- Local testing implementation using the local filesystem (inside a non-public `.storage` folder).
- Design supports an S3-compatible provider for production via environment variables.

## 5. Malware Scanning Architecture
- Interface: `ScannerProvider` (methods: `scanFile`).
- Implementation using `clamav.js` (TCP interface to a local ClamAV docker container) or a mock scanner for development fallback that correctly simulates async latency and results.
- Scanning is handled asynchronously by the BullMQ worker in the `apps/worker` service to prevent blocking the upload request.

## 6. Upload and Processing Lifecycle
1. **Upload Request**: Client sends a `multipart/form-data` request with file and metadata.
2. **Synchronous Validation (API)**: Backend validates MIME, file extension, magic bytes (using `file-type`), size limits, and user authentication.
3. **Quarantine Storage**: File is temporarily saved in a local quarantine area.
4. **Database Record**: Document record created with `status: quarantined`.
5. **Job Enqueue**: A BullMQ job is queued to process the file. API returns `202 Accepted` to client.
6. **Worker Processing**:
   - Updates status to `scanning`.
   - Calls ScannerProvider.
   - If infected: status `infected`, delete from quarantine.
   - If clean: move to permanent private StorageProvider, update `storageKey`, delete from quarantine, status `clean`.
7. **M1 -> M2 Handoff**: Worker queues an event payload to a `m2-ocr` BullMQ queue. Status becomes `queued`.

## 7. Secure Access Lifecycle
- Route: `GET /api/documents/:id/access`
- Authenticates user.
- Authorizes access (user must be owner or have officer role for the case).
- Checks document status (must be `clean`, `queued`, `processing`, or `completed`).
- Generates a short-lived (e.g., 5-minute) signed URL via StorageProvider.
- Audits the access event.

## 8. Frontend UX Architecture
- Next.js App Router.
- Shadcn UI (accessible Radix primitives) for forms, dialogs, progress bars, and badges.
- `react-dropzone` for drag-and-drop.
- `react-hook-form` and Zod for client-side form validation.
- Polling (SWR or React Query) on document status until it reaches a terminal/stable state (`queued`, `infected`, `rejected`, `failed`).
- Explicit visual states for: Uploading, Scanning, Clean, Rejected, Error.

## 9. Failure/Retry and Idempotency Strategy
- Client can retry an upload; checksum deduplication checks if a successful version already exists for the same user/file.
- Worker jobs have exponential backoff for `scan-error` or transient storage errors.
- Dead Letter Queue for jobs that permanently fail, manual intervention possible.
- If queue publishing fails after DB save, a periodic reconciliation cron can re-queue stuck `quarantined` documents.

## 10. M1 -> M2 Integration Contract
A stable Zod schema in `packages/shared` representing the queue payload:
```typescript
{
  version: "1.0",
  documentId: string,
  storageKey: string,
  requestedType: string,
  // Other non-sensitive metadata for OCR
}
```

## 11. Testing Strategy
- **Unit**: Vitest for utility functions, state machine logic, and Zod schemas.
- **Integration**: Supertest against Express API for upload flow, auth bypassing mock for local tests. Storage/Scanner mocked.
- **E2E**: Playwright (optional, if time permits) or manual rigorous UI testing.

## 12. Environment and Docker
- Docker Compose to run: MongoDB, Redis (for BullMQ), ClamAV (for scanning).
- `.env.example` mapping all required configurations.
