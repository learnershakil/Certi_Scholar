# CertiScholar (Group Project)

Welcome to the **CertiScholar** project repository. This project is a comprehensive end-to-end scholarship document processing, verification, and recommendation system developed by our group. 

## Project Structure & Modules

CertiScholar is designed as a highly scalable **Monorepo** using NPM Workspaces. The system is conceptually divided into 10 independent modules.

```text
C:\certiScholar
|-- apps/
|   |-- frontend/           # Next.js 14 App Router (Student & Officer Portal)
|   |   |-- src/app/        # React Pages & Layouts
|   |   |-- src/components/ # Shared UI components (Tailwind CSS)
|   |   \-- src/lib/        # Frontend utilities and API clients
|   |
|   |-- backend/            # Express.js API (Orchestration & Status endpoints)
|   |   |-- src/controllers/# Request handling and business logic
|   |   |-- src/middlewares/# Auth and Validation guards
|   |   |-- src/models/     # Mongoose MongoDB schemas
|   |   |-- src/routes/     # Express API route definitions
|   |   |-- src/services/   # Core logic (Storage, Validation, Queues)
|   |
|   |-- worker/             # BullMQ Background Worker (Heavy async tasks)
|       |-- src/config/     # Database and Redis connectivity
|       |-- src/jobs/       # Background job processors (e.g., Malware Scan)
|       |-- src/services/   # External integrations (ClamAV, Storage)
|
|-- packages/
|   |-- shared/             # Monorepo Shared Library
|       |-- src/schemas/    # Zod validation schemas
|       |-- src/types/      # Shared TypeScript definitions
|
|-- docs/                   # Technical Documentation (M1 Completion Reports)
|-- .gitignore              # Global git exclusions
|-- docker-compose.yml      # Infrastructure definitions (Redis, MongoDB)
|-- package.json            # Monorepo Workspace Configuration
```

### Module Status
- [COMPLETED] **M1 - Secure Document Intake:** Completed. (Owner: Vaibhav Tyagi)
- [PENDING] **M2 - M10:** Pending team implementation.

---

## M1: Secure Document Intake (Owner: Vaibhav Tyagi)

As an independent contribution to the team project, **Module 1 (M1)** has been architected and strictly implemented by **Vaibhav Tyagi**. 

M1 handles the foundational security layer of CertiScholar. It is responsible for securely accepting, validating, quarantining, and malware-scanning sensitive identity, income, and academic documents before any downstream OCR or verification (M2+) can occur.

### M1 Features & Security Highlights:
- **Server-Side Validation:** Independent magic-byte MIME type validation protecting against spoofed extensions.
- **Asynchronous Processing:** BullMQ-based background workers strictly isolate API performance from heavy ClamAV malware scanning.
- **Idempotency:** SHA-256 checksums prevent duplicate processing for identical uploads.
- **Resource Level Authorization (IDOR):** Complete containment; students cannot read or poll status for documents they do not own.
- **Cryptographic Signed Access:** No permanent URLs exist. Document binaries are served securely via 5-minute expiry HMAC SHA-256 signed tokens.
- **Zero-Config Local Dev:** Intelligent fallback queue simulates ClamAV delays securely when a local Redis server isn't available, enabling seamless frontend development.

For detailed technical implementation of M1, please see my [`docs/m1/COMPLETION_REPORT.md`](./docs/m1/COMPLETION_REPORT.md).

---

## Getting Started (Local Development)

To run the CertiScholar monorepo locally:

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Copy `.env.example` to `.env` and fill in necessary database/secret credentials.

3. **Start the Development Stack**
   ```bash
   npm run dev
   ```
   *This single command concurrently spins up the Next.js Frontend (port 3000), Express Backend (port 3001), and the BullMQ Worker.*

4. **Access the Portal**
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Tech Stack
- **Frontend:** Next.js, React, Tailwind CSS, Framer Motion, SWR
- **Backend:** Node.js, Express, TypeScript
- **Database:** MongoDB (Mongoose)
- **Queues/Workers:** BullMQ, Redis
- **Security:** ClamAV, HMAC SHA-256
