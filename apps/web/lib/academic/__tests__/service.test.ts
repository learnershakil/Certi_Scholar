import { describe, expect, it } from "bun:test";
import {
  AcademicVerificationService,
  InMemoryRecordRepository,
  SessionAcademicHistoryRepository,
} from "../service";
import type { HistoryEntry } from "../types";

describe("academic service & repositories", () => {
  it("InMemoryRecordRepository returns sample records and finds by ID", async () => {
    const repo = new InMemoryRecordRepository();
    const samples = await repo.getSampleRecords();

    expect(samples.length).toBeGreaterThan(0);
    const first = samples[0]!;
    const found = await repo.getRecordById(first.id);

    expect(found).toBeDefined();
    expect(found?.id).toBe(first.id);
    expect(found?.record.subjects.length).toBe(first.record.subjects.length);

    const nonExistent = await repo.getRecordById("non-existent-id");
    expect(nonExistent).toBeUndefined();
  });

  it("SessionAcademicHistoryRepository records checks and caps history", async () => {
    const repo = new SessionAcademicHistoryRepository(3);
    expect(await repo.getRecentChecks()).toEqual([]);

    const entry1: HistoryEntry = {
      key: "c1",
      recordId: "demo-1",
      recordLabel: "Sample 1",
      checkedAt: "2026-10-21T10:00:00Z",
      status: "CONSISTENT",
      subjectCount: 5,
      issues: [],
      recalculatedPercentage: 85,
    };

    const entry2: HistoryEntry = {
      key: "c2",
      recordId: "demo-2",
      recordLabel: "Sample 2",
      checkedAt: "2026-10-21T10:05:00Z",
      status: "INCONSISTENT",
      subjectCount: 3,
      issues: ["Mismatch"],
      recalculatedPercentage: 70,
    };

    await repo.saveCheck(entry1);
    await repo.saveCheck(entry2);

    let history = await repo.getRecentChecks();
    expect(history.length).toBe(2);
    expect(history[0]?.key).toBe("c2"); // Newest first

    // Add 2 more to test cap of 3
    await repo.saveCheck({ ...entry1, key: "c3" });
    await repo.saveCheck({ ...entry1, key: "c4" });

    history = await repo.getRecentChecks();
    expect(history.length).toBe(3);
    expect(history[0]?.key).toBe("c4");

    await repo.clearHistory();
    expect(await repo.getRecentChecks()).toEqual([]);
  });

  it("instantiates default AcademicVerificationService", () => {
    const service = new AcademicVerificationService();
    expect(service.records).toBeDefined();
    expect(service.checker).toBeDefined();
    expect(service.history).toBeDefined();
  });
});
