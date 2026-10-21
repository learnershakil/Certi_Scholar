import type { AcademicRecord } from "@repo/academic-engine";
import { SAMPLE_RECORDS, findSampleById } from "./sample-records";
import { requestAcademicCheck, type CheckRequestOutcome } from "./request-check";
import type { HistoryEntry, RecordEnvelope } from "./types";

/**
 * Repository interface for obtaining academic records.
 *
 * Current: In-memory synthetic demonstration records.
 * Future MongoDB Integration:
 * When connecting MongoDB, implement this interface using a backend API client
 * (e.g. GET /api/academic-records/[id]) that queries the student documents collection.
 */
export interface AcademicRecordRepository {
  getSampleRecords(): Promise<readonly RecordEnvelope[]>;
  getRecordById(id: string): Promise<RecordEnvelope | undefined>;
}

/**
 * Service interface for executing consistency checks.
 *
 * Delegates to the backend route POST /api/academic-check which runs
 * the @repo/academic-engine's runAcademicCheck() without exposing database logic.
 */
export interface AcademicCheckService {
  executeCheck(record: AcademicRecord): Promise<CheckRequestOutcome>;
}

/**
 * Repository interface for storing and retrieving recent check audit logs.
 *
 * Current: Session-only in-memory storage (cleared on page reload).
 * Future MongoDB Integration:
 * When M10 persistent audit logging is active, implement this interface by
 * posting to POST /api/academic-checks/history to persist records into a MongoDB
 * `academic_verification_history` collection.
 */
export interface AcademicHistoryRepository {
  getRecentChecks(): Promise<readonly HistoryEntry[]>;
  saveCheck(entry: HistoryEntry): Promise<void>;
  clearHistory(): Promise<void>;
}

/**
 * In-memory implementation of the AcademicRecordRepository using synthetic samples.
 */
export class InMemoryRecordRepository implements AcademicRecordRepository {
  async getSampleRecords(): Promise<readonly RecordEnvelope[]> {
    return SAMPLE_RECORDS;
  }

  async getRecordById(id: string): Promise<RecordEnvelope | undefined> {
    return findSampleById(id);
  }
}

/**
 * HTTP implementation of the AcademicCheckService that posts to the internal Next.js API.
 */
export class HttpAcademicCheckService implements AcademicCheckService {
  async executeCheck(record: AcademicRecord): Promise<CheckRequestOutcome> {
    return requestAcademicCheck(record);
  }
}

/**
 * Session-based in-memory implementation of AcademicHistoryRepository.
 * Keeps up to maxEntries in browser memory.
 */
export class SessionAcademicHistoryRepository
  implements AcademicHistoryRepository
{
  private entries: HistoryEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 20) {
    this.maxEntries = maxEntries;
  }

  async getRecentChecks(): Promise<readonly HistoryEntry[]> {
    return [...this.entries];
  }

  async saveCheck(entry: HistoryEntry): Promise<void> {
    this.entries = [entry, ...this.entries].slice(0, this.maxEntries);
  }

  async clearHistory(): Promise<void> {
    this.entries = [];
  }
}

/**
 * Unified verification service facade providing clean separation
 * between UI components and academic verification data access.
 */
export class AcademicVerificationService {
  constructor(
    public readonly records: AcademicRecordRepository = new InMemoryRecordRepository(),
    public readonly checker: AcademicCheckService = new HttpAcademicCheckService(),
    public readonly history: AcademicHistoryRepository = new SessionAcademicHistoryRepository(),
  ) {}
}

export const defaultAcademicService = new AcademicVerificationService();
