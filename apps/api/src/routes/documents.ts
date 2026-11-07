import { createHash } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import {
  ConsistencyCheckModel,
  ProfileMatchModel,
  CorrectionModel,
  DocumentModel,
  DocumentTypeModel,
  ExtractedFieldModel,
  STAGES,
  VerificationResultModel,
  type VerificationStatus,
} from '../models/document.js';
import { DocumentAccessLogModel, ProcessingTimelineModel, getSettings } from '../models/system.js';
import { actor, parse, requireRole, paging, sendPage } from '../lib/http.js';
import { documentScope, loadDocument } from '../lib/access.js';
import { badRequest, conflict, HttpError } from '../lib/errors.js';
import { hasActivePdfContent, sniffMime } from '../lib/fileType.js';
import { malwareScanner } from '../lib/scanner.js';
import { blobStore } from '../lib/storage.js';
import { signAccessToken } from '../lib/crypto.js';
import { audit, notify, timeline } from '../lib/events.js';
import { jobQueue } from '../pipeline/queue.js';
import { recomputeConsistency, reevaluateApplicationsFor } from '../pipeline/documentPipeline.js';
import { authenticityStatement } from '../verification/providers.js';
import { recordManualVerification, requestVerification } from '../services/verification.js';

export const documents = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config().MAX_UPLOAD_BYTES, files: 1 } });
const MULTIPART_OVERHEAD = 64 * 1024;
export const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export const tooLargeMessage = (size?: number) =>
  `${size ? `This file is ${megabytes(size)}. ` : 'This file is too large. '}The limit is ${megabytes(config().MAX_UPLOAD_BYTES)}. Compress it or scan it at a lower resolution, then upload again.`;

/**
 * Refuses an oversized upload from its declared length without buffering it. The body is read and discarded first:
 * answering mid-upload resets the connection, and the browser (or the web proxy) would then show no reason at all.
 */
const rejectOversize = (req: Request, _res: Response, next: NextFunction) => {
  const declared = Number(req.headers['content-length']);
  if (!(declared > config().MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD)) return next();
  const refusal = new HttpError(413, 'file_too_large', tooLargeMessage(declared));
  req.on('end', () => next(refusal));
  req.on('error', () => next(refusal));
  req.resume();
};

/** What the upload form should check before sending, from the same configuration the server enforces. */
documents.get('/upload-policy', (_req, res) => {
  res.json({ maxBytes: config().MAX_UPLOAD_BYTES, accept: ['application/pdf', 'image/png', 'image/jpeg'] });
});

/** M1 — secure intake. Type is sniffed from content, the file is scanned before it is stored, and stored encrypted. */
documents.post('/', requireRole('student'), rejectOversize, upload.single('file'), async (req, res) => {
  const me = actor(req);
  const file = req.file;
  if (!file) throw badRequest('Choose a file to upload');
  const mime = sniffMime(file.buffer);
  if (!mime) throw new HttpError(415, 'unsupported_type', `"${file.originalname}" is not a PDF, PNG or JPEG file. Save or scan the document in one of those formats and upload again.`);
  if (mime === 'application/pdf' && hasActivePdfContent(file.buffer)) {
    throw new HttpError(422, 'active_content', 'PDFs containing scripts or embedded files are not accepted');
  }
  const scan = await malwareScanner().scan(file.buffer);
  if (!scan.clean) {
    await audit(me, 'document.rejected_malware', 'Upload', file.originalname, { signature: scan.signature, engine: scan.engine }, req.ip);
    throw new HttpError(422, 'malware_detected', `Virus found in "${file.originalname}" (${scan.signature ?? 'unnamed threat'}). The file was not stored.`, { signature: scan.signature, engine: scan.engine });
  }

  const declaredType = typeof req.body?.declaredType === 'string' && req.body.declaredType ? req.body.declaredType : undefined;
  if (declaredType && !(await DocumentTypeModel.exists({ code: declaredType, active: true }))) throw badRequest('Unknown document type');
  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  const settings = await getSettings();
  const doc = await DocumentModel.create({
    owner: me.id,
    originalName: file.originalname.replace(/[^\w.\- ]/g, '_').slice(0, 120),
    mime,
    size: file.size,
    sha256,
    storageKey: await blobStore().put(file.buffer),
    declaredType,
    scan: { engine: scan.engine, clean: true, scannedAt: new Date() },
    stages: STAGES.map((name) => (name === 'scan' ? { name, status: 'done', attempts: 1, startedAt: new Date(), finishedAt: new Date() } : { name })),
    retainUntil: new Date(Date.now() + settings.retentionDays * 86_400_000),
  });
  await timeline({ document: doc._id, stage: 'scan', status: 'done', message: `No virus found (${scan.engine})`, actor: me.id });
  await audit(me, 'document.uploaded', 'Document', doc._id, { sha256, mime, size: file.size }, req.ip);
  await jobQueue().add('document.ocr', { documentId: doc.id }, { jobId: `ocr:${doc.id}:1` });
  await notify(me.id, 'document_received', `We received "${doc.originalName}". Processing has started.`, `/documents/${doc.id}`);
  res.status(202).json({ id: doc.id, status: doc.status, originalName: doc.originalName, scan: { engine: scan.engine, clean: true } });
});

const summary = (d: InstanceType<typeof DocumentModel>) => ({
  id: d.id,
  originalName: d.originalName,
  mime: d.mime,
  size: d.size,
  status: d.status,
  documentType: d.documentType,
  classification: d.classification,
  declaredType: d.declaredType,
  profileFormat: d.profileFormat,
  stages: d.stages,
  verification: d.verification,
  scan: d.scan?.engine ? { engine: d.scan.engine, clean: d.scan.clean, scannedAt: d.scan.scannedAt } : undefined,
  rejection: d.rejection?.reason ? { reason: d.rejection.reason, at: d.rejection.at } : undefined,
  authenticity: authenticityStatement((d.verification?.status ?? 'not_verified') as VerificationStatus),
  assignedTo: d.assignedTo,
  owner: d.owner,
  createdAt: d.get('createdAt'),
  updatedAt: d.get('updatedAt'),
});

/** For each document, how its details compare with the owner's profile: the worst result across its fields. */
async function profileStatus(ids: unknown[]) {
  const matches = await ProfileMatchModel.find({ document: { $in: ids } } as Record<string, unknown>, 'document results.outcome').lean();
  return new Map(
    matches.map((m) => {
      const outcomes = (m.results ?? []).map((r) => r.outcome);
      return [String(m.document), outcomes.includes('mismatch') ? 'mismatch' : outcomes.includes('unclear') ? 'unclear' : outcomes.length ? 'match' : null];
    }),
  );
}

documents.get('/', async (req, res) => {
  const filter: Record<string, unknown> = await documentScope(actor(req));
  if (typeof req.query.status === 'string') filter.status = req.query.status;
  const p = paging(req);
  const [docs, total] = await Promise.all([
    DocumentModel.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit),
    p.paged ? DocumentModel.countDocuments(filter) : undefined,
  ]);
  const status = await profileStatus(docs.map((d) => d._id));
  sendPage(res, p, docs.map((d) => ({ ...summary(d), profileMatch: status.get(d.id) ?? null })), total);
});

const AWAITING_VERIFICATION = ['not_verified', 'simulated_match', 'simulated_mismatch', 'provider_error', 'authority_not_found'];
const QUEUE_WORK: Record<string, unknown> = {
  $or: [{ status: { $in: ['needs_review', 'failed'] } }, { status: 'processed', 'verification.status': { $in: AWAITING_VERIFICATION } }],
};
const claimable = (userId: string): Record<string, unknown> => ({ $or: [{ assignedTo: null }, { assignedTo: userId }] });

/** Review queue (field review, failed processing, verification work): metadata only. Officers claim a case before they can open its content. */
documents.get('/review-queue', requireRole('verifier', 'admin'), async (req, res) => {
  const me = actor(req);
  const filter: Record<string, unknown> = { $and: [QUEUE_WORK, me.role === 'verifier' ? claimable(me.id) : {}] };
  const docs = await DocumentModel.find(filter)
    .sort({ createdAt: 1 })
    .limit(config().LIST_PAGE_SIZE)
    .lean();
  const counts = await ExtractedFieldModel.aggregate([
    { $match: { document: { $in: docs.map((d) => d._id) }, status: 'needs_review' } },
    { $group: { _id: '$document', n: { $sum: 1 } } },
  ]);
  const pending = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json(
    docs.map((d) => ({
      id: String(d._id),
      documentType: d.documentType,
      status: d.status,
      reason: d.status === 'processed' ? 'verification' : d.status === 'failed' ? 'processing_failed' : 'field_review',
      pendingFields: pending.get(String(d._id)) ?? 0,
      assignedTo: d.assignedTo ? String(d.assignedTo) : null,
      createdAt: d.createdAt,
    })),
  );
});

documents.post('/:id/claim', requireRole('verifier'), async (req, res) => {
  const me = actor(req);
  const filter: Record<string, unknown> = { _id: String(req.params.id), $and: [QUEUE_WORK, claimable(me.id)] };
  const doc = await DocumentModel.findOneAndUpdate(filter, { assignedTo: me.id }, { returnDocument: 'after' });
  if (!doc) throw conflict('Document is not available to claim');
  await audit(me, 'document.claimed', 'Document', doc._id, undefined, req.ip);
  await timeline({ document: doc._id, stage: 'review', status: 'claimed', actor: me.id });
  res.json(summary(doc));
});

documents.get('/:id', async (req, res) => {
  const doc = await loadDocument(actor(req), String(req.params.id));
  const [checks, verificationResults] = await Promise.all([
    ConsistencyCheckModel.find({ document: doc._id }).lean(),
    VerificationResultModel.find({ document: doc._id }).sort({ createdAt: -1 }).lean(),
  ]);
  const status = await profileStatus([doc._id]);
  res.json({ ...summary(doc), profileMatch: status.get(doc.id) ?? null, consistencyChecks: checks, verificationResults });
});

documents.get('/:id/status', async (req, res) => {
  const doc = await loadDocument(actor(req), String(req.params.id));
  res.json({ id: doc.id, status: doc.status, stages: doc.stages, verification: doc.verification });
});

documents.get('/:id/fields', async (req, res) => {
  const doc = await loadDocument(actor(req), String(req.params.id));
  const fields = await ExtractedFieldModel.find({ document: doc._id }).sort({ group: 1, row: 1, _id: 1 }).lean();
  res.json(fields);
});

const correctionBody = z.object({ value: z.string().trim().min(1).max(500), reason: z.string().trim().min(3).max(500) });

/** M5 — authorised correction. Every change is recorded with before/after values and a reason. */
documents.patch('/:id/fields/:key', requireRole('verifier', 'admin'), async (req, res) => {
  const me = actor(req);
  const doc = await loadDocument(me, String(req.params.id), { write: true });
  const body = parse(correctionBody, req.body);
  const field = await ExtractedFieldModel.findOne({ document: doc._id, key: req.params.key });
  if (!field) throw badRequest(`Unknown field ${req.params.key}`);
  await CorrectionModel.create({
    document: doc._id,
    fieldKey: field.key,
    documentType: doc.documentType,
    previousValue: field.value,
    newValue: body.value,
    previousConfidence: field.confidence?.overall,
    reason: body.reason,
    actor: me.id,
  });
  field.value = body.value;
  field.status = 'corrected';
  await field.save();
  await audit(me, 'field.corrected', 'Document', doc._id, { field: field.key, reason: body.reason }, req.ip);
  await recomputeConsistency(doc._id);
  res.json(field);
});

documents.post('/:id/fields/:key/confirm', requireRole('verifier', 'admin'), async (req, res) => {
  const me = actor(req);
  const doc = await loadDocument(me, String(req.params.id), { write: true });
  const field = await ExtractedFieldModel.findOne({ document: doc._id, key: req.params.key });
  if (!field) throw badRequest(`Unknown field ${req.params.key}`);
  if (field.value === null) throw badRequest('A missing value must be corrected, not confirmed');
  field.status = 'confirmed';
  await field.save();
  await audit(me, 'field.confirmed', 'Document', doc._id, { field: field.key, value: field.value }, req.ip);
  res.json(field);
});

documents.post('/:id/review/complete', requireRole('verifier', 'admin'), async (req, res) => {
  const me = actor(req);
  const doc = await loadDocument(me, String(req.params.id), { write: true });
  if (!doc.documentType) throw conflict('Set the document type before completing review');
  const pending = await ExtractedFieldModel.countDocuments({ document: doc._id, status: 'needs_review' });
  if (pending) throw conflict(`${pending} field(s) still need review`);
  doc.status = 'processed';
  doc.reviewCompletedAt = new Date();
  doc.reviewedBy = me.id as never;
  await doc.save();
  await audit(me, 'review.completed', 'Document', doc._id, undefined, req.ip);
  await timeline({ document: doc._id, stage: 'review', status: 'done', actor: me.id });
  await notify(doc.owner, 'processing_complete', `"${doc.originalName}" has been reviewed.`, `/documents/${doc.id}`);
  await reevaluateApplicationsFor(doc._id);
  res.json(summary(doc));
});

/** The comparison of this document's details with its owner's profile. */
documents.get('/:id/profile-match', async (req, res) => {
  const doc = await loadDocument(actor(req), String(req.params.id));
  res.json((await ProfileMatchModel.findOne({ document: doc._id }).lean()) ?? null);
});

const rejectBody = z.object({ reason: z.string().trim().min(5, 'Give the student a reason of at least 5 characters').max(500) });

/**
 * A verifier rejects a document that cannot be used (the wrong document, unreadable, not the applicant's). It leaves
 * the review queue, never counts towards an application, and the student is told why so they can upload the right one.
 */
documents.post('/:id/reject', requireRole('verifier', 'admin'), async (req, res) => {
  const me = actor(req);
  const doc = await loadDocument(me, String(req.params.id), { write: true });
  const { reason } = parse(rejectBody, req.body);
  if (doc.status === 'rejected') throw conflict('This document has already been rejected');
  if (doc.status === 'purged') throw conflict('This document has been deleted under the retention policy');
  doc.status = 'rejected';
  doc.rejection = { reason, at: new Date(), by: me.id as never };
  await doc.save();
  await audit(me, 'document.rejected', 'Document', doc._id, { reason }, req.ip);
  await timeline({ document: doc._id, stage: 'review', status: 'rejected', message: reason, actor: me.id });
  await notify(doc.owner, 'document_rejected', `"${doc.originalName}" was rejected: ${reason} Please upload the correct document.`, '/documents');
  await reevaluateApplicationsFor(doc._id);
  res.json(summary(doc));
});

const typeBody = z.object({ documentType: z.string(), reason: z.string().trim().min(3) });

documents.post('/:id/type', requireRole('verifier', 'admin'), async (req, res) => {
  const me = actor(req);
  const doc = await loadDocument(me, String(req.params.id), { write: true });
  const body = parse(typeBody, req.body);
  if (!(await DocumentTypeModel.exists({ code: body.documentType, active: true }))) throw badRequest('Unknown document type');
  const previous = doc.documentType;
  doc.documentType = body.documentType;
  doc.classification = { ...(doc.classification ?? {}), source: 'officer', overriddenBy: me.id as never };
  await doc.save();
  await audit(me, 'document.type_set', 'Document', doc._id, { previous, next: body.documentType, reason: body.reason }, req.ip);
  await jobQueue().add('document.analyse', { documentId: doc.id }, { jobId: `analyse:${doc.id}:${Date.now()}` });
  res.status(202).json(summary(doc));
});

const reprocessBody = z.object({ from: z.enum(['ocr', 'analyse']).default('ocr') });

/** Idempotent reprocessing from a given stage; a failed OCR document is retried from its stored file. */
documents.post('/:id/reprocess', requireRole('verifier', 'admin'), async (req, res) => {
  const me = actor(req);
  const doc = await loadDocument(me, String(req.params.id), { write: true });
  if (doc.status === 'purged' || doc.status === 'rejected') throw conflict('Document can no longer be processed');
  const { from } = parse(reprocessBody, req.body ?? {});
  const reset = from === 'ocr' ? ['ocr', 'classify', 'extract', 'consistency'] : ['classify', 'extract', 'consistency'];
  for (const s of doc.stages) if (reset.includes(s.name)) Object.assign(s, { status: 'pending', error: undefined });
  doc.status = 'queued';
  await doc.save();
  await audit(me, 'document.reprocess', 'Document', doc._id, { from }, req.ip);
  await jobQueue().add(from === 'ocr' ? 'document.ocr' : 'document.analyse', { documentId: doc.id }, { jobId: `${from}:${doc.id}:${Date.now()}` });
  res.status(202).json({ id: doc.id, status: doc.status });
});

const accessBody = z.object({ variant: z.enum(['original', 'preview']).default('preview') });

/** Issues a short-lived signed URL. No document has a permanent or guessable address. */
documents.post('/:id/access-url', async (req, res) => {
  const me = actor(req);
  const doc = await loadDocument(me, String(req.params.id));
  const { variant } = parse(accessBody, req.body ?? {});
  if (!(variant === 'preview' ? doc.previewKey ?? doc.storageKey : doc.storageKey)) throw conflict('No file is available');
  const exp = Math.floor(Date.now() / 1000) + config().PRESIGN_TTL_SECONDS;
  const token = signAccessToken({ documentId: doc.id, variant, userId: me.id, exp }, config().PRESIGN_SECRET);
  res.json({ url: `/api/v1/files/${token}`, expiresAt: new Date(exp * 1000).toISOString() });
});

documents.post('/:id/verify', requireRole('verifier', 'scholarship_officer', 'admin'), async (req, res) => {
  const me = actor(req);
  await loadDocument(me, String(req.params.id));
  const request = await requestVerification(String(req.params.id), me);
  res.status(202).json(request);
});

const manualBody = z.object({ outcome: z.enum(['match', 'mismatch']), note: z.string().trim().min(10).max(1000) });

documents.post('/:id/verify/manual', requireRole('verifier', 'admin'), async (req, res) => {
  const me = actor(req);
  await loadDocument(me, String(req.params.id), { write: true });
  const body = parse(manualBody, req.body);
  res.status(201).json(await recordManualVerification(String(req.params.id), me, body.outcome, body.note));
});

documents.get('/:id/timeline', async (req, res) => {
  const doc = await loadDocument(actor(req), String(req.params.id));
  res.json(await ProcessingTimelineModel.find({ document: doc._id }).sort({ createdAt: 1 }).populate('actor', 'name role').lean());
});

documents.get('/:id/corrections', requireRole('verifier', 'scholarship_officer', 'admin'), async (req, res) => {
  const doc = await loadDocument(actor(req), String(req.params.id));
  res.json(await CorrectionModel.find({ document: doc._id }).sort({ createdAt: -1 }).populate('actor', 'name').lean());
});

documents.get('/:id/access-log', requireRole('admin'), async (req, res) => {
  const doc = await loadDocument(actor(req), String(req.params.id));
  res.json(await DocumentAccessLogModel.find({ document: doc._id }).sort({ createdAt: -1 }).populate('actor', 'name role').lean());
});

