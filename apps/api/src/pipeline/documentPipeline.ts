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
import { audit, logger, notify, timeline } from '../lib/events.js';
import { ocrClient, OcrServiceError, type OcrResult } from '../ocr/client.js';
import { classify, fullText, pickBestProfile, type Profile } from '../domain/extraction.js';
import { runConsistencyChecks } from '../domain/consistency.js';
import { matchDocumentToProfile, needsOfficer } from '../services/profileMatch.js';
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
    const result = classify(fullText(ocr), types, settings.classificationThreshold, settings.classificationMargin);
    let documentType = result.documentType;
    let source: 'keywords' | 'declared' = 'keywords';
    // The student's choice settles an inconclusive result, but only if the text shows some sign of that type.
    // It never overrides a confident classification, and every extracted field is still confidence-checked.
    const declared = doc.declaredType;
    if (!documentType && declared && (result.scores[declared] ?? 0) > 0) {
      documentType = declared;
      source = 'declared';
    }
    doc.documentType = documentType;
    doc.classification = { confidence: result.confidence, scores: result.scores, source };
    if (declared && result.documentType && declared !== result.documentType) {
      await timeline({ document: doc._id, stage: 'classify', status: 'note', message: `Student declared ${declared}; the text reads as ${result.documentType}` });
    }
  });

  if (!doc.documentType) {
    for (const s of doc.stages) if (s.name === 'extract' || s.name === 'consistency') s.status = 'skipped';
    doc.status = 'needs_review';
    await doc.save();
    await timeline({ document: doc._id, stage: 'classify', status: 'needs_review', message: 'Document type could not be determined with confidence' });
    return;
  }

  await stage(doc, 'extract', async () => {
    // The newest active version of each format for this type; the layout that fits best wins.
    const active = await ExtractionProfileModel.find({ documentType: doc.documentType, active: true }).sort({ version: -1 }).lean();
    const newestPerFormat = active.filter((p, i) => active.findIndex((q) => q.format === p.format) === i);
    const best = pickBestProfile(ocr, newestPerFormat as unknown as Array<Profile & { format: string; version: number }>, settings.defaultConfidenceThreshold, settings.unreadableLineConfidence);
    if (!best) throw new PermanentJobError(`No active extraction profile for ${doc.documentType}`);
    const { profile, values } = best;
    // Idempotent reprocessing: machine output is replaced; officer corrections are re-applied on top.
    const corrections = await CorrectionModel.find({ document: doc._id }).sort({ createdAt: 1 }).lean();
    const latest = new Map(corrections.map((c) => [c.fieldKey, c.newValue]));
    await ExtractedFieldModel.deleteMany({ document: doc._id });
    await ExtractedFieldModel.insertMany(
      values.map((v) =>
        latest.has(v.key) ? { ...v, document: doc._id, value: latest.get(v.key), status: 'corrected' } : { ...v, document: doc._id },
      ),
    );
    doc.profileFormat = profile.format;
    doc.profileVersion = profile.version;
    await timeline({ document: doc._id, stage: 'extract', status: 'profile', message: `${profile.format} v${profile.version}: ${Math.round(best.coverage * 100)}% of required fields found` });
  });

  await stage(doc, 'consistency', () => recomputeConsistency(doc._id));

  // Advice for the officer, never a gate on its own: failures fall back to exact rules inside matchDocumentToProfile.
  const match = await matchDocumentToProfile(doc._id).catch((err) => {
    logger.error({ err, documentId }, 'profile match failed');
    return null;
  });
  const pending = await ExtractedFieldModel.countDocuments({ document: doc._id, status: 'needs_review' });
  const profileDiffers = needsOfficer(match);
  doc.status = pending || profileDiffers ? 'needs_review' : 'processed';
  await doc.save();
  if (profileDiffers) {
    await timeline({ document: doc._id, stage: 'consistency', status: 'profile_mismatch', message: `Details differ from the applicant profile (${match!.engine})` });
  }
  if (pending || profileDiffers) {
    const why = [pending && `${pending} field(s) awaiting review`, profileDiffers && 'details that differ from your profile'].filter(Boolean).join(' and ');
    await notify(doc.owner, 'review_required', `"${doc.originalName}" has ${why}. An officer will check it.`, `/documents/${doc.id}`);
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
  const checks = runConsistencyChecks(doc?.documentType ?? null, values, settings.percentageTolerance, {
    certificateValidityDays: settings.certificateValidityDays,
    minPlausibleAge: settings.minPlausibleAge,
    maxPlausibleAge: settings.maxPlausibleAge,
  });
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
