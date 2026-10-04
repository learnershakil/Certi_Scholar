import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Queue, Worker } from "bullmq";
import { BullMqResultPublisher } from "../../src/adapters.js";
import type { ClassificationCompletedEvent } from "../../src/contracts.js";
import { QUEUES } from "../../src/queues.js";
import { TEST_REDIS, resetRedis } from "./helpers.js";

function makeEvent(overrides: {
  documentId: string;
  status: "classified" | "needs_review";
  confidence?: number;
  documentTypeCode?: string | null;
  extractionProfileId?: string | null;
  reason?:
    | "low_confidence"
    | "empty_text"
    | "no_document_types"
    | "ambiguous"
    | "no_anchor"
    | "excluded_term"
    | null;
}): ClassificationCompletedEvent {
  return {
    version: "1",
    documentId: overrides.documentId,
    status: overrides.status,
    source: "auto",
    documentTypeCode:
      overrides.documentTypeCode ??
      (overrides.status === "classified" ? "MARKSHEET" : null),
    extractionProfileId: overrides.extractionProfileId ?? null,
    confidence:
      overrides.confidence ?? (overrides.status === "classified" ? 0.9 : 0.2),
    candidates:
      overrides.status === "classified"
        ? [{ code: "MARKSHEET", score: 0.9 }]
        : [],
    evidence: overrides.status === "classified" ? ["marks obtained"] : [],
    reason:
      overrides.reason ??
      (overrides.status === "classified" ? null : "low_confidence"),
    classifierVersion: "keyword-v2",
  };
}

describe("BullMqResultPublisher integration", () => {
  let publisher: BullMqResultPublisher;
  let extractionQueue: Queue<ClassificationCompletedEvent>;
  let reviewQueue: Queue<ClassificationCompletedEvent>;

  beforeAll(() => {
    publisher = new BullMqResultPublisher(TEST_REDIS);
    extractionQueue = new Queue<ClassificationCompletedEvent>(QUEUES.EXTRACTION, {
      connection: TEST_REDIS,
    });
    reviewQueue = new Queue<ClassificationCompletedEvent>(QUEUES.REVIEW, {
      connection: TEST_REDIS,
    });
  });

  afterAll(async () => {
    await publisher.close();
    await extractionQueue.close();
    await reviewQueue.close();
  });

  beforeEach(async () => {
    await resetRedis();
  });

  it("classified event -> extraction waiting count 1, review 0", async () => {
    const event = makeEvent({ documentId: "doc-4a", status: "classified" });
    await publisher.publish(event);

    expect(await extractionQueue.getWaitingCount()).toBe(1);
    expect(await reviewQueue.getWaitingCount()).toBe(0);
  });

  it("then a needs_review event for the same documentId -> review 1, extraction 0", async () => {
    const classifiedEvent = makeEvent({ documentId: "doc-4b", status: "classified" });
    await publisher.publish(classifiedEvent);

    expect(await extractionQueue.getWaitingCount()).toBe(1);
    expect(await reviewQueue.getWaitingCount()).toBe(0);

    const reviewEvent = makeEvent({ documentId: "doc-4b", status: "needs_review" });
    await publisher.publish(reviewEvent);

    expect(await extractionQueue.getWaitingCount()).toBe(0);
    expect(await reviewQueue.getWaitingCount()).toBe(1);
  });

  it("publishing the same classified event twice leaves exactly 1 waiting job in extraction, and the job data equals the LATEST payload", async () => {
    const event1 = makeEvent({ documentId: "doc-4c", status: "classified", confidence: 0.75 });
    await publisher.publish(event1);

    const event2 = makeEvent({ documentId: "doc-4c", status: "classified", confidence: 0.95 });
    await publisher.publish(event2);

    expect(await extractionQueue.getWaitingCount()).toBe(1);

    const job = await extractionQueue.getJob("extraction-doc-4c");
    expect(job).not.toBeNull();
    expect(job?.data.confidence).toBe(0.95);
  });

  it("a job in the FAILED state in the same queue is replaced by a new publish", async () => {
    const docId = "doc-4d";
    const jobId = `${QUEUES.EXTRACTION}-${docId}`;

    await extractionQueue.add(
      "classification-completed",
      makeEvent({ documentId: docId, status: "classified", confidence: 0.5 }),
      { jobId, attempts: 1, removeOnFail: false },
    );

    const worker = new Worker(QUEUES.EXTRACTION, null, { connection: TEST_REDIS });
    const token = "fail-token-4d";
    const job = await worker.getNextJob(token);
    expect(job).not.toBeNull();
    if (job) {
      await job.moveToFailed(new Error("test failure"), token, false);
      const state = await job.getState();
      expect(state).toBe("failed");
    }
    await worker.close();

    const newEvent = makeEvent({ documentId: docId, status: "classified", confidence: 0.99 });
    await publisher.publish(newEvent);

    expect(await extractionQueue.getWaitingCount()).toBe(1);
    const replacedJob = await extractionQueue.getJob(jobId);
    expect(replacedJob).not.toBeNull();
    expect(await replacedJob?.getState()).toBe("waiting");
    expect(replacedJob?.data.confidence).toBe(0.99);
  });

  it("an active (locked) job in the opposite queue is NOT removed, and publish still succeeds", async () => {
    const docId = "doc-4e";
    const oppositeJobId = `${QUEUES.REVIEW}-${docId}`;

    await reviewQueue.add(
      "classification-completed",
      makeEvent({ documentId: docId, status: "needs_review" }),
      { jobId: oppositeJobId },
    );

    const worker = new Worker(QUEUES.REVIEW, null, { connection: TEST_REDIS });
    const token = "active-token-4e";
    const activeJob = await worker.getNextJob(token);
    expect(activeJob).not.toBeNull();
    expect(await activeJob?.getState()).toBe("active");

    const classifiedEvent = makeEvent({ documentId: docId, status: "classified" });
    await publisher.publish(classifiedEvent);

    const oppositeJobAfter = await reviewQueue.getJob(oppositeJobId);
    expect(oppositeJobAfter).not.toBeNull();
    expect(await oppositeJobAfter?.getState()).toBe("active");

    expect(await extractionQueue.getWaitingCount()).toBe(1);

    await worker.close();
  });
});
