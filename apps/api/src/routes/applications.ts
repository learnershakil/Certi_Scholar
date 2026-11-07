import { Router } from 'express';
import { z } from 'zod';
import { DocumentModel, DocumentTypeModel } from '../models/document.js';
import { UserModel } from '../models/user.js';
import { profileComplete } from '../services/applicantDetails.js';
import { ApplicationModel, RecommendationModel, ScholarshipModel } from '../models/scholarship.js';
import { ProcessingTimelineModel } from '../models/system.js';
import { actor, parse, requireRole, paging, sendPage } from '../lib/http.js';
import { applicationScope, loadApplication } from '../lib/access.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit, notify, timeline } from '../lib/events.js';
import { jobQueue } from '../pipeline/queue.js';
import { config } from '../config.js';
import { evaluateApplication } from '../services/recommendation.js';

export const applications = Router();

const createBody = z.object({ scholarshipId: z.string(), documentIds: z.array(z.string()).min(1).max(10) });

applications.post('/', requireRole('student'), async (req, res) => {
  const me = actor(req);
  const body = parse(createBody, req.body);
  const scholarship = await ScholarshipModel.findOne({ _id: body.scholarshipId, active: true });
  if (!scholarship) throw notFound('Scholarship');
  const student = await UserModel.findById(me.id).lean();
  if (!profileComplete(student!)) throw badRequest('Complete your profile (name, parents\' names, gender and state) before applying');
  const owned = await DocumentModel.find({ _id: { $in: body.documentIds }, owner: me.id, status: { $nin: ['rejected', 'purged'] } }, 'documentType').lean();
  if (owned.length !== new Set(body.documentIds).size) throw badRequest('Documents must be your own, active uploads');
  // Every required document must be attached, identified by its classified type (not by what the file is called).
  const attached = new Set(owned.map((d) => d.documentType));
  const missing = (scholarship.requiredDocuments ?? []).filter((t) => !attached.has(t));
  if (missing.length) {
    const names = await DocumentTypeModel.find({ code: { $in: missing } }, 'code name').lean();
    const label = (t: string) => names.find((n) => n.code === t)?.name ?? t;
    throw badRequest(`Attach every required document: ${missing.map(label).join(', ')} missing. A document counts once it has been processed and identified.`, { missing });
  }
  const app = await ApplicationModel.create({ student: me.id, scholarship: scholarship._id, documents: body.documentIds });
  await audit(me, 'application.submitted', 'Application', app._id, { scholarship: scholarship.code });
  await timeline({ application: app._id, stage: 'application', status: 'submitted', actor: me.id });
  await jobQueue().add('application.evaluate', { applicationId: app.id }, { jobId: `evaluate:${app.id}:initial` });
  res.status(201).json(app);
});

applications.get('/', async (req, res) => {
  const filter: Record<string, unknown> = await applicationScope(actor(req));
  if (typeof req.query.status === 'string') filter.status = req.query.status;
  if (typeof req.query.scholarshipId === 'string') filter.scholarship = req.query.scholarshipId;
  const p = paging(req);
  const [items, total] = await Promise.all([
    ApplicationModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(p.skip)
      .limit(p.limit)
      .populate('student', 'name email profile')
      .populate('scholarship', 'name code')
      .populate('latestRecommendation', 'outcome summary createdAt')
      .lean(),
    p.paged ? ApplicationModel.countDocuments(filter) : undefined,
  ]);
  sendPage(res, p, items, total);
});

applications.get('/:id', async (req, res) => {
  const app = await loadApplication(actor(req), String(req.params.id));
  await app.populate([
    { path: 'student', select: 'name email profile' },
    { path: 'scholarship', select: 'name code amount requiredDocuments' },
    { path: 'documents', select: 'originalName documentType status verification' },
  ]);
  res.json(app);
});

applications.get('/:id/recommendation', async (req, res) => {
  const app = await loadApplication(actor(req), String(req.params.id));
  const rec = await RecommendationModel.findOne({ application: app._id }).sort({ createdAt: -1 }).lean();
  if (!rec) throw notFound('Recommendation');
  res.json(rec);
});

applications.post('/:id/recommendation', requireRole('scholarship_officer', 'admin'), async (req, res) => {
  const me = actor(req);
  const app = await loadApplication(me, String(req.params.id));
  const rec = await evaluateApplication(app.id, me.id);
  await audit(me, 'recommendation.generated', 'Application', app._id, { outcome: rec?.outcome });
  res.status(201).json(rec);
});

const decisionBody = z.object({ outcome: z.enum(['awarded', 'rejected']), note: z.string().trim().min(3).max(1000) });

applications.post('/:id/decision', requireRole('scholarship_officer', 'admin'), async (req, res) => {
  const me = actor(req);
  const app = await loadApplication(me, String(req.params.id));
  const body = parse(decisionBody, req.body);
  if (!app.latestRecommendation) throw conflict('A recommendation must exist before a decision');
  if (['awarded', 'rejected', 'withdrawn'].includes(app.status)) throw conflict('A decision has already been recorded');
  app.status = body.outcome;
  app.decision = { outcome: body.outcome, note: body.note, by: me.id as never, at: new Date() };
  await app.save();
  const scholarship = await ScholarshipModel.findById(app.scholarship).lean();
  await audit(me, 'application.decided', 'Application', app._id, body);
  await timeline({ application: app._id, stage: 'decision', status: body.outcome, message: body.note, actor: me.id });
  await notify(app.student, 'award_decision', `Decision on ${scholarship?.name}: ${body.outcome}.`, `/applications/${app.id}`);
  res.json(app);
});

/** Full processing timeline: application events plus every stage of every attached document. */
applications.get('/:id/timeline', async (req, res) => {
  const app = await loadApplication(actor(req), String(req.params.id));
  res.json(
    await ProcessingTimelineModel.find({ $or: [{ application: app._id }, { document: { $in: app.documents } }] })
      .sort({ createdAt: 1 })
      .populate('actor', 'name role')
      .populate('document', 'originalName')
      .lean(),
  );
});
