import { Router } from 'express';
import { z } from 'zod';
import { DocumentModel } from '../models/document.js';
import { ApplicationModel, RecommendationModel, ScholarshipModel } from '../models/scholarship.js';
import { ProcessingTimelineModel } from '../models/system.js';
import { actor, parse, requireRole } from '../lib/http.js';
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
  const owned = await DocumentModel.countDocuments({ _id: { $in: body.documentIds }, owner: me.id, status: { $nin: ['rejected', 'purged'] } });
  if (owned !== body.documentIds.length) throw badRequest('Documents must be your own, active uploads');
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
  res.json(
    await ApplicationModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(config().LIST_PAGE_SIZE)
      .populate('student', 'name email profile')
      .populate('scholarship', 'name code')
      .populate('latestRecommendation', 'outcome summary createdAt')
      .lean(),
  );
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
