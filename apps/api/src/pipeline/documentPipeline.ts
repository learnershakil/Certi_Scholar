import { Types } from 'mongoose';
import {
  ConsistencyCheckModel,
  CorrectionModel,
  DocumentModel,
  DocumentTypeModel,
  ExtractedFieldModel,
  ExtractionProfileModel,
  type DocumentRecord,
  type StageName,
} from '../models/document.js';
import { ApplicationModel } from '../models/scholarship.js';
import { getSettings } from '../models/system.js';
import { blobStore } from '../lib/storage.js';
import { audit, notify, timeline } from '../lib/events.js';
import { ocrClient, OcrServiceError, type OcrResult } from '../ocr/client.js';
import { classify, extractFields, fullText, type Profile } from '../domain/extraction.js';
import { runConsistencyChecks } from '../domain/consistency.js';
import { jobQueue, PermanentJobError, type JobContext } from './queue.js';

async function stage<T>(doc: DocumentRecord, name: StageName, work: () => Promise<T>): Promise<T> {
  const s = doc.stages.find((x) => x.name === name)!;
  const started = Date.now();
  s.status = 'running';
  s.attempts = (s.attempts ?? 0) + 1;
  s.startedAt = new Date(started);
  s.error = undefined;
  doc.status = 'processing';
  await doc.save();
  try {
    const result = await work();
    s.status = 'done';
    s.finishedAt = new Date();
    await doc.save();
    await timeline({ document: doc._id, stage: name, status: 'done', durationMs: Date.now() - started });
    return result;
  } catch (err) {
    s.status = 'failed';
    s.finishedAt = new Date();
    s.error = (err as Error).message;
    await doc.save();
    await timeline({ document: doc._id, stage: name, status: 'failed', message: s.error, durationMs: Date.now() - started });
    throw err;
  }
}

/** OCR stage. On final failure the document stays `failed` with the stored file intact, so it can be retried. */
export async function runOcr(documentId: string, ctx: JobContext) {
  const doc = await DocumentModel.findById(documentId);
  if (!doc || doc.status === 'purged' || doc.status === 'rejected') return;
  try {
    await stage(doc, 'ocr', async () => {
      const file = await blobStore().get(doc.storageKey!);
      const result = await ocrClient().recognise(file, doc.mime, doc.originalName);
      if (result.preview) {
        const old = doc.previewKey;
        doc.previewKey = await blobStore().put(Buffer.from(result.preview.base64, 'base64'));
        if (old) await blobStore().remove(old);
      }
      doc.ocrProvider = result.provider;
      doc.set('ocr', { ...result, preview: null });
    });
  } catch (err) {
    const retryable = !(err instanceof OcrServiceError) || err.retryable;
    if (!retryable || ctx.finalAttempt) {
      doc.status = 'failed';
      await doc.save();
      await notify(doc.owner, 'additional_document_needed', `We could not read "${doc.originalName}". An officer will retry it or you may upload a clearer copy.`, `/documents/${doc.id}`);
      if (!retryable) throw new PermanentJobError((err as Error).message);
    }
    throw err;
  }
  await jobQueue().add('document.analyse', { documentId }, { jobId: `analyse:${documentId}:${Date.now()}` });
}

/** Classification → extraction → consistency. Fast stages, run on their own queue. */
export async function runAnalyse(documentId: string) {
  const doc = await DocumentModel.findById(documentId).select('+ocr');
  if (!doc || !doc.ocr || doc.status === 'purged') return;
  const settings = await getSettings();
  const ocr = doc.ocr as OcrResult;

  await stage(doc, 'classify', async () => {
    if (doc.classification?.overriddenBy) return; // an officer has set the type; respect it
    const types = await DocumentTypeModel.find({ active: true }).lean();
    const result = classify(fullText(ocr), types, settings.classificationThreshold);
    doc.documentType = result.documentType;
    doc.classification = { confidence: result.confidence, scores: result.scores };
  });

  if (!doc.documentType) {
    for (const s of doc.stages) if (s.name === 'extract' || s.name === 'consistency') s.status = 'skipped';
    doc.status = 'needs_review';
    await doc.save();
    await timeline({ document: doc._id, stage: 'classify', status: 'needs_review', message: 'Document type could not be determined with confidence' });
    return;
  }

  await stage(doc, 'extract', async () => {
    const profile = await ExtractionProfileModel.findOne({ documentType: doc.documentType, active: true }).sort({ version: -1 }).lean();
    if (!profile) throw new PermanentJobError(`No active extraction profile for ${doc.documentType}`);
    const values = extractFields(ocr, profile as unknown as Profile, settings.defaultConfidenceThreshold);
    // Idempotent reprocessing: machine output is replaced; officer corrections are re-applied on top.
    const corrections = await CorrectionModel.find({ document: doc._id }).sort({ createdAt: 1 }).lean();
    const latest = new Map(corrections.map((c) => [c.fieldKey, c.newValue]));
    await ExtractedFieldModel.deleteMany({ document: doc._id });
    await ExtractedFieldModel.insertMany(
      values.map((v) =>
        latest.has(v.key) ? { ...v, document: doc._id, value: latest.get(v.key), status: 'corrected' } : { ...v, document: doc._id },
      ),
    );
    doc.profileVersion = profile.version;
  });

  await stage(doc, 'consistency', () => recomputeConsistency(doc._id));

  const pending = await ExtractedFieldModel.countDocuments({ document: doc._id, status: 'needs_review' });
  doc.status = pending ? 'needs_review' : 'processed';
  await doc.save();
  if (pending) {
    await notify(doc.owner, 'review_required', `"${doc.originalName}" has ${pending} field(s) awaiting officer review.`, `/documents/${doc.id}`);
  } else {
    await notify(doc.owner, 'processing_complete', `"${doc.originalName}" has been processed.`, `/documents/${doc.id}`);
    await reevaluateApplicationsFor(doc._id);
  }
}

export async function recomputeConsistency(documentId: Types.ObjectId) {
  const [doc, fields, settings] = await Promise.all([
    DocumentModel.findById(documentId).lean(),
    ExtractedFieldModel.find({ document: documentId }).lean(),
    getSettings(),
  ]);
  const values = Object.fromEntries(fields.map((f) => [f.key, f.value]));
  const checks = runConsistencyChecks(doc?.documentType ?? null, values, settings.percentageTolerance);
  await ConsistencyCheckModel.deleteMany({ document: documentId });
  await ConsistencyCheckModel.insertMany(checks.map((c) => ({ ...c, document: documentId })));
  return checks;
}

export async function reevaluateApplicationsFor(documentId: Types.ObjectId) {
  const apps = await ApplicationModel.find({ documents: documentId, status: { $in: ['submitted', 'under_review', 'evaluated'] } }).select('_id').lean();
  for (const a of apps) await jobQueue().add('application.evaluate', { applicationId: String(a._id) }, { jobId: `evaluate:${a._id}:${Date.now()}` });
}

/** Retention sweep: removes stored files and extracted personal data past the retention date; audit history is kept. */
export async function runRetention(now = new Date()) {
  const expired = await DocumentModel.find({ retainUntil: { $lte: now }, status: { $ne: 'purged' } });
  for (const doc of expired) {
    if (doc.storageKey) await blobStore().remove(doc.storageKey);
    if (doc.previewKey) await blobStore().remove(doc.previewKey);
    await ExtractedFieldModel.deleteMany({ document: doc._id });
    doc.set({ storageKey: undefined, previewKey: undefined, ocr: undefined, status: 'purged', purgedAt: now });
    await doc.save();
    await audit(null, 'document.purged', 'Document', doc._id, { reason: 'retention' });
  }
  return expired.length;
}
