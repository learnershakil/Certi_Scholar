import { Router } from 'express';
import { z } from 'zod';
import { ScholarshipModel, ScholarshipRuleModel } from '../models/scholarship.js';
import { DocumentTypeModel } from '../models/document.js';
import { actor, parse, requireRole } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../lib/events.js';
import { describeFacts, type FactText } from '../domain/facts.js';
import { getSettings } from '../models/system.js';
import { evaluate, OPERATORS, ruleNodeSchema, validateRule } from '../domain/rules.js';

export const scholarships = Router();

const scholarshipBody = z.object({
  code: z.string().regex(/^[A-Z0-9_-]{2,30}$/),
  name: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  sponsor: z.string().max(200).optional(),
  amount: z.number().nonnegative().optional(),
  deadline: z.coerce.date().optional(),
  requiredDocuments: z.array(z.string()).default([]),
  officers: z.array(z.string()).default([]),
  active: z.boolean().default(true),
});

scholarships.get('/', async (req, res) => {
  const filter = actor(req).role === 'student' ? { active: true } : {};
  res.json(await ScholarshipModel.find(filter).sort({ name: 1 }).populate('officers', 'name email').lean());
});

/** Required documents must be active document types, which administrators manage as data. */
async function assertKnownTypes(codes?: string[]) {
  if (!codes?.length) return;
  const known = await DocumentTypeModel.countDocuments({ code: { $in: codes }, active: true });
  if (known !== new Set(codes).size) throw badRequest('Unknown document type in requiredDocuments');
}

scholarships.post('/', requireRole('admin'), async (req, res) => {
  const body = parse(scholarshipBody, req.body);
  await assertKnownTypes(body.requiredDocuments);
  const s = await ScholarshipModel.create(body);
  await audit(actor(req), 'scholarship.created', 'Scholarship', s._id, { code: s.code });
  res.status(201).json(s);
});

scholarships.patch('/:id', requireRole('admin'), async (req, res) => {
  const body = parse(scholarshipBody.partial(), req.body);
  await assertKnownTypes(body.requiredDocuments);
  const s = await ScholarshipModel.findByIdAndUpdate(req.params.id, body, { returnDocument: 'after' });
  if (!s) throw notFound('Scholarship');
  await audit(actor(req), 'scholarship.updated', 'Scholarship', s._id, body);
  res.json(s);
});

/** The vocabulary for the no-code builder. */
scholarships.get('/facts', async (_req, res) => {
  res.json({ facts: describeFacts((await getSettings()).factText as FactText), operators: OPERATORS });
});

scholarships.get('/rules', requireRole('admin', 'scholarship_officer'), async (_req, res) => {
  res.json(await ScholarshipRuleModel.find({ active: true }).sort({ scholarship: 1, version: -1 }).lean());
});

const testBody = z.object({ root: ruleNodeSchema, facts: z.record(z.string(), z.unknown()) });

/** Test harness: evaluate a draft rule against a hypothetical applicant without saving anything. */
scholarships.post('/rules/test', requireRole('admin'), async (req, res) => {
  const body = parse(testBody, req.body);
  const problems = validateRule(body.root);
  if (problems.length) throw badRequest('Rule is invalid', problems);
  res.json(evaluate(body.root, body.facts, (await getSettings()).factText as FactText));
});

scholarships.get('/:id/rules', requireRole('admin', 'scholarship_officer'), async (req, res) => {
  res.json(await ScholarshipRuleModel.find({ scholarship: req.params.id }).sort({ version: -1 }).populate('createdBy', 'name').lean());
});

const ruleBody = z.object({ root: ruleNodeSchema, changeNote: z.string().trim().min(3).max(500) });

/** Saving creates a new version and deactivates the previous one; no deployment involved. */
scholarships.put('/:id/rules', requireRole('admin'), async (req, res) => {
  const me = actor(req);
  const scholarship = await ScholarshipModel.findById(req.params.id);
  if (!scholarship) throw notFound('Scholarship');
  const body = parse(ruleBody, req.body);
  const problems = validateRule(body.root);
  if (problems.length) throw badRequest('Rule is invalid', problems);
  const latest = await ScholarshipRuleModel.findOne({ scholarship: scholarship._id }).sort({ version: -1 }).lean();
  const version = (latest?.version ?? 0) + 1;
  await ScholarshipRuleModel.updateMany({ scholarship: scholarship._id }, { active: false });
  const rule = await ScholarshipRuleModel.create({ scholarship: scholarship._id, version, root: body.root, changeNote: body.changeNote, createdBy: me.id });
  await audit(me, 'rule.published', 'Scholarship', scholarship._id, { version, changeNote: body.changeNote });
  res.status(201).json(rule);
});
