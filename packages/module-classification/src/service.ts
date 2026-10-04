import type { ResultPublisher, TimelineEmitter } from "./adapters.js";
import {
  ClassificationCompletedEvent,
  OcrCompletedEvent,
  type DocumentTypeInput,
  type TimelineEvent,
} from "./contracts.js";
import { ClassificationModel, DocumentTypeModel } from "./models.js";
import type { DocumentClassifier, DocumentTypeDef } from "./types.js";

const STAGE = "classification";

export interface Actor {
  type: "system" | "user";
  id: string;
}
const SYSTEM: Actor = { type: "system", id: "classification-service" };

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

export interface ClassificationServiceDeps {
  classifier: DocumentClassifier;
  publisher: ResultPublisher;
  timeline: TimelineEmitter;
}

/**
 * The single entry point used by BOTH the HTTP routes and the BullMQ worker.
 * Idempotent: classifications are upserted by documentId, never appended.
 */
export class ClassificationService {
  private readonly deps: ClassificationServiceDeps;

  constructor(deps: ClassificationServiceDeps) {
    this.deps = deps;
  }

  async run(
    input: unknown,
    opts: { actor?: Actor; force?: boolean } = {},
  ): Promise<ClassificationCompletedEvent> {
    const event = OcrCompletedEvent.parse(input);
    const actor = opts.actor ?? SYSTEM;

    // A reviewer's decision is never silently overwritten by a reprocess.
    const existing = await ClassificationModel.findOne({ documentId: event.documentId }).lean();
    if (existing?.source === "manual" && !opts.force) {
      return this.toEvent(existing);
    }

    await this.emitTimeline(event.documentId, "started", actor);

    try {
      const types = (await DocumentTypeModel.find({ active: true }).lean()) as DocumentTypeDef[];
      const result = await this.deps.classifier.classify({ text: event.text }, types);

      const saved = await ClassificationModel.findOneAndUpdate(
        { documentId: event.documentId },
        {
          $set: {
            ...result,
            source: "auto",
            classifierVersion: this.deps.classifier.version,
            reviewedBy: null,
            reviewNote: null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      const out = this.toEvent(saved);
      await this.emitTimeline(
        event.documentId,
        out.status === "classified" ? "completed" : "needs_review",
        actor,
        { documentTypeCode: out.documentTypeCode, confidence: out.confidence, reason: out.reason },
      );
      await this.deps.publisher.publish(out);
      return out;
    } catch (err) {
      await this.emitTimeline(event.documentId, "failed", actor, {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err; // BullMQ retries; the upsert makes a retry safe.
    }
  }

  async get(documentId: string): Promise<ClassificationCompletedEvent | null> {
    const doc = await ClassificationModel.findOne({ documentId }).lean();
    return doc ? this.toEvent(doc) : null;
  }

  /** Reviewer override. Audit detail (who/why) is stored and emitted to the timeline. */
  async setManual(
    documentId: string,
    input: { documentTypeCode: string; actorId: string; reason?: string | undefined },
  ): Promise<ClassificationCompletedEvent> {
    const type = await DocumentTypeModel.findOne({
      code: input.documentTypeCode,
      active: true,
    }).lean();
    if (!type) throw new NotFoundError(`Unknown or inactive document type: ${input.documentTypeCode}`);

    const saved = await ClassificationModel.findOneAndUpdate(
      { documentId },
      {
        $set: {
          status: "classified",
          source: "manual",
          documentTypeCode: type.code,
          extractionProfileId: type.extractionProfileId ?? null,
          confidence: 1,
          reason: null,
          classifierVersion: "manual",
          reviewedBy: input.actorId,
          reviewNote: input.reason ?? null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    const out = this.toEvent(saved);
    await this.emitTimeline(documentId, "completed", { type: "user", id: input.actorId }, {
      manualOverride: true,
      documentTypeCode: type.code,
      reason: input.reason ?? null,
    });
    await this.deps.publisher.publish(out);
    return out;
  }

  // ---------- Document type admin ----------
  listTypes() {
    return DocumentTypeModel.find().sort({ code: 1 }).lean();
  }

  async getType(code: string) {
    const t = await DocumentTypeModel.findOne({ code }).lean();
    if (!t) throw new NotFoundError(`Document type not found: ${code}`);
    return t;
  }

  async createType(input: DocumentTypeInput) {
    if (await DocumentTypeModel.exists({ code: input.code })) {
      throw new ConflictError(`Document type already exists: ${input.code}`);
    }
    return (await DocumentTypeModel.create(input)).toObject();
  }

  async updateType(code: string, input: DocumentTypeInput) {
    if (input.code !== code) throw new ConflictError("The code of a document type cannot be changed");
    const t = await DocumentTypeModel.findOneAndUpdate({ code }, { $set: input }, { new: true }).lean();
    if (!t) throw new NotFoundError(`Document type not found: ${code}`);
    return t;
  }

  // ---------- helpers ----------
  private toEvent(doc: {
    documentId: string;
    status: "classified" | "needs_review";
    source?: "auto" | "manual" | null | undefined;
    documentTypeCode?: string | null | undefined;
    extractionProfileId?: string | null | undefined;
    confidence: number;
    candidates?: { code?: string | null | undefined; score?: number | null | undefined }[] | undefined;
    evidence?: string[] | undefined;
    reason?: string | null | undefined;
    classifierVersion: string;
  }): ClassificationCompletedEvent {
    return ClassificationCompletedEvent.parse({
      version: "1",
      documentId: doc.documentId,
      status: doc.status,
      source: doc.source ?? "auto",
      documentTypeCode: doc.documentTypeCode ?? null,
      extractionProfileId: doc.extractionProfileId ?? null,
      confidence: doc.confidence,
      candidates: (doc.candidates ?? []).map((c) => ({ code: c.code, score: c.score })),
      evidence: doc.evidence ?? [],
      reason: doc.reason ?? null,
      classifierVersion: doc.classifierVersion,
    });
  }

  /** Timeline problems must never break classification. */
  private async emitTimeline(
    documentId: string,
    status: TimelineEvent["status"],
    actor: Actor,
    meta?: Record<string, unknown>,
  ) {
    try {
      await this.deps.timeline.emit({
        version: "1",
        documentId,
        stage: STAGE,
        status,
        actor,
        timestamp: new Date().toISOString(),
        ...(meta ? { meta } : {}),
      });
    } catch (err) {
      console.error("[classification] timeline emit failed", err);
    }
  }
}
