import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { ClassificationService, NotFoundError, ConflictError } from "../../src/service.js";
import { KeywordClassifier } from "../../src/classifier.js";
import { ClassificationModel, DocumentTypeModel } from "../../src/models.js";
import type { DocumentTypeInput } from "../../src/contracts.js";
import {
  connectTestDb,
  disconnectTestDb,
  resetDb,
  FakeResultPublisher,
  ThrowingResultPublisher,
  FakeTimelineEmitter,
  ThrowingTimelineEmitter,
  ThrowingDocumentClassifier,
} from "./helpers.js";

const marksheetText =
  "CENTRAL BOARD OF SECONDARY EDUCATION Statement of Marks Roll No: 123456 Total Marks: 450 Result: PASS Grade: A1";
const unknownText =
  "This is a random electricity bill payment receipt with no relevant certificates";

describe("ClassificationService integration", () => {
  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it("run() twice for the same documentId leaves exactly 1 classifications row", async () => {
    const publisher = new FakeResultPublisher();
    const timeline = new FakeTimelineEmitter();
    const service = new ClassificationService({
      classifier: new KeywordClassifier(),
      publisher,
      timeline,
    });

    await service.run({ version: "1", documentId: "doc-3a", text: marksheetText });
    await service.run({ version: "1", documentId: "doc-3a", text: marksheetText });

    const count = await ClassificationModel.countDocuments({ documentId: "doc-3a" });
    expect(count).toBe(1);
  });

  it("a manual override (setManual) survives run() without force, and run() with force: true replaces it with source 'auto'", async () => {
    const publisher = new FakeResultPublisher();
    const timeline = new FakeTimelineEmitter();
    const service = new ClassificationService({
      classifier: new KeywordClassifier(),
      publisher,
      timeline,
    });

    await service.setManual("doc-3b", {
      documentTypeCode: "MARKSHEET",
      actorId: "reviewer-1",
      reason: "verified manually",
    });

    const manualDoc = await ClassificationModel.findOne({ documentId: "doc-3b" });
    expect(manualDoc?.source).toBe("manual");
    expect(manualDoc?.reviewedBy).toBe("reviewer-1");

    const unchanged = await service.run({
      version: "1",
      documentId: "doc-3b",
      text: marksheetText,
    });
    expect(unchanged.source).toBe("manual");

    const stillManualDoc = await ClassificationModel.findOne({ documentId: "doc-3b" });
    expect(stillManualDoc?.source).toBe("manual");
    expect(stillManualDoc?.reviewedBy).toBe("reviewer-1");

    const replaced = await service.run(
      { version: "1", documentId: "doc-3b", text: marksheetText },
      { force: true },
    );
    expect(replaced.source).toBe("auto");

    const autoDoc = await ClassificationModel.findOne({ documentId: "doc-3b" });
    expect(autoDoc?.source).toBe("auto");
    expect(autoDoc?.reviewedBy).toBeNull();
  });

  it("run() with invalid input (missing text) throws a ZodError and writes no row", async () => {
    const publisher = new FakeResultPublisher();
    const timeline = new FakeTimelineEmitter();
    const service = new ClassificationService({
      classifier: new KeywordClassifier(),
      publisher,
      timeline,
    });

    await expect(
      service.run({ version: "1", documentId: "doc-3c" }),
    ).rejects.toThrow();

    const count = await ClassificationModel.countDocuments({ documentId: "doc-3c" });
    expect(count).toBe(0);
  });

  it("if the timeline emitter throws, run() still resolves and the row is saved", async () => {
    const publisher = new FakeResultPublisher();
    const timeline = new ThrowingTimelineEmitter();
    const service = new ClassificationService({
      classifier: new KeywordClassifier(),
      publisher,
      timeline,
    });

    const result = await service.run({
      version: "1",
      documentId: "doc-3d",
      text: marksheetText,
    });
    expect(result.status).toBe("classified");

    const count = await ClassificationModel.countDocuments({ documentId: "doc-3d" });
    expect(count).toBe(1);
  });

  it("if the publisher throws, run() rejects, the row is already saved, and a second run() with a working publisher resolves and still leaves 1 row", async () => {
    const throwingPublisher = new ThrowingResultPublisher();
    const timeline = new FakeTimelineEmitter();
    const service1 = new ClassificationService({
      classifier: new KeywordClassifier(),
      publisher: throwingPublisher,
      timeline,
    });

    await expect(
      service1.run({ version: "1", documentId: "doc-3e", text: marksheetText }),
    ).rejects.toThrow("Publisher failure");

    expect(await ClassificationModel.countDocuments({ documentId: "doc-3e" })).toBe(1);

    const workingPublisher = new FakeResultPublisher();
    const service2 = new ClassificationService({
      classifier: new KeywordClassifier(),
      publisher: workingPublisher,
      timeline,
    });

    const result = await service2.run({
      version: "1",
      documentId: "doc-3e",
      text: marksheetText,
    });
    expect(result.status).toBe("classified");
    expect(await ClassificationModel.countDocuments({ documentId: "doc-3e" })).toBe(1);
    expect(workingPublisher.events.length).toBe(1);
  });

  it("timeline order on success is started then completed or started then needs_review; when classifier throws, order is started then failed and run() rejects", async () => {
    const publisher = new FakeResultPublisher();
    const timeline = new FakeTimelineEmitter();
    const service = new ClassificationService({
      classifier: new KeywordClassifier(),
      publisher,
      timeline,
    });

    await service.run({ version: "1", documentId: "doc-3f-classified", text: marksheetText });
    expect(timeline.events.map((e) => e.status)).toEqual(["started", "completed"]);

    timeline.events.length = 0;
    await service.run({ version: "1", documentId: "doc-3f-review", text: unknownText });
    expect(timeline.events.map((e) => e.status)).toEqual(["started", "needs_review"]);

    timeline.events.length = 0;
    const failingService = new ClassificationService({
      classifier: new ThrowingDocumentClassifier(),
      publisher,
      timeline,
    });
    await expect(
      failingService.run({ version: "1", documentId: "doc-3f-fail", text: marksheetText }),
    ).rejects.toThrow("Classifier failure");
    expect(timeline.events.map((e) => e.status)).toEqual(["started", "failed"]);
  });

  it("setManual with an unknown document type throws NotFoundError; a valid one publishes an event with source 'manual', status 'classified', and stores reviewedBy and reviewNote", async () => {
    const publisher = new FakeResultPublisher();
    const timeline = new FakeTimelineEmitter();
    const service = new ClassificationService({
      classifier: new KeywordClassifier(),
      publisher,
      timeline,
    });

    await expect(
      service.setManual("doc-3g", {
        documentTypeCode: "DOES_NOT_EXIST",
        actorId: "officer-42",
      }),
    ).rejects.toThrow(NotFoundError);

    const event = await service.setManual("doc-3g", {
      documentTypeCode: "MARKSHEET",
      actorId: "officer-42",
      reason: "Manual inspection verified CBSE board",
    });

    expect(event.source).toBe("manual");
    expect(event.status).toBe("classified");
    expect(publisher.events.length).toBe(1);
    expect(publisher.events[0]?.source).toBe("manual");
    expect(publisher.events[0]?.status).toBe("classified");

    const saved = await ClassificationModel.findOne({ documentId: "doc-3g" });
    expect(saved?.reviewedBy).toBe("officer-42");
    expect(saved?.reviewNote).toBe("Manual inspection verified CBSE board");
  });

  it("createType with an existing code throws ConflictError; updateType with a different code in the body throws ConflictError", async () => {
    const service = new ClassificationService({
      classifier: new KeywordClassifier(),
      publisher: new FakeResultPublisher(),
      timeline: new FakeTimelineEmitter(),
    });

    const duplicateType: DocumentTypeInput = {
      code: "MARKSHEET",
      name: "Duplicate Marksheet",
      keywords: [{ term: "marks", weight: 1.0 }],
      regexPatterns: [],
      anchorTerms: ["marks"],
      excludeTerms: [],
      minConfidence: 0.4,
      extractionProfileId: null,
      active: true,
    };
    await expect(service.createType(duplicateType)).rejects.toThrow(ConflictError);

    const mismatchedUpdate: DocumentTypeInput = {
      code: "NEW_CODE",
      name: "Updated Marksheet",
      keywords: [{ term: "marks", weight: 1.0 }],
      regexPatterns: [],
      anchorTerms: ["marks"],
      excludeTerms: [],
      minConfidence: 0.4,
      extractionProfileId: null,
      active: true,
    };
    await expect(service.updateType("MARKSHEET", mismatchedUpdate)).rejects.toThrow(ConflictError);
  });

  it("the published event for a classified marksheet carries the extractionProfileId of its document type (set one on MARKSHEET first)", async () => {
    const publisher = new FakeResultPublisher();
    const timeline = new FakeTimelineEmitter();
    const service = new ClassificationService({
      classifier: new KeywordClassifier(),
      publisher,
      timeline,
    });

    await DocumentTypeModel.updateOne(
      { code: "MARKSHEET" },
      { $set: { extractionProfileId: "cbse-extractor-v1" } },
    );

    const event = await service.run({
      version: "1",
      documentId: "doc-3i",
      text: marksheetText,
    });

    expect(event.status).toBe("classified");
    expect(event.extractionProfileId).toBe("cbse-extractor-v1");
    expect(publisher.events[0]?.extractionProfileId).toBe("cbse-extractor-v1");

    const saved = await ClassificationModel.findOne({ documentId: "doc-3i" });
    expect(saved?.extractionProfileId).toBe("cbse-extractor-v1");
  });
});
