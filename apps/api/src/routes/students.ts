import { Router } from 'express';
import { z } from 'zod';
import { UserModel } from '../models/user.js';
import { FACT_CATALOG } from '../domain/facts.js';
import { actor, parse, requireRole, paging, sendPage } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { audit, notify } from '../lib/events.js';
import { APPLICANT_DETAILS, DETAIL_LABELS, applicantDetailsChanged, detailValue, profileComplete, type ApplicantDetail } from '../services/applicantDetails.js';

/** Verification officers and administrators look up students and correct their applicant details. */
export const students = Router();
students.use(requireRole('verifier', 'admin'));

type StudentRecord = Parameters<typeof profileComplete>[0] & { _id: unknown; email: string; active?: boolean | null; profile?: { fatherName?: string | null; motherName?: string | null; gender?: string | null; state?: string | null; phone?: string | null } | null };
const view = (u: StudentRecord) => ({
  id: String(u._id),
  email: u.email,
  name: u.name ?? null,
  active: u.active !== false,
  profile: { fatherName: u.profile?.fatherName, motherName: u.profile?.motherName, gender: u.profile?.gender, state: u.profile?.state, phone: u.profile?.phone },
  profileComplete: profileComplete(u),
});

students.get('/', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter: Record<string, unknown> = { role: 'student', ...(q && { $or: [{ name: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }] }) };
  const p = paging(req);
  const [items, total] = await Promise.all([
    UserModel.find(filter).sort({ name: 1, email: 1 }).skip(p.skip).limit(p.limit).lean(),
    p.paged ? UserModel.countDocuments(filter) : undefined,
  ]);
  sendPage(res, p, items.map((u) => view(u as StudentRecord)), total);
});

const personName = z.string().trim().min(2, 'Too short').max(100).regex(/^[\p{L} .'-]+$/u, 'Use letters, spaces, dots and apostrophes only');
const correctionBody = z.object({
  name: personName.optional(),
  profile: z
    .object({
      fatherName: personName,
      motherName: personName,
      gender: z.string().refine((v) => FACT_CATALOG['applicant.gender'].options!.includes(v), 'Not a valid gender'),
      state: z.string().trim().min(2).max(60),
    })
    .partial()
    .default({}),
  reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500),
});

/** Corrects a student's details. The change and its reason are audited, the student is told, and their documents are re-matched. */
students.patch('/:id', async (req, res) => {
  const me = actor(req);
  const body = parse(correctionBody, req.body);
  const user = await UserModel.findOne({ _id: req.params.id, role: 'student' });
  if (!user) throw notFound('Student');
  const next: Partial<Record<ApplicantDetail, string>> = { ...(body.name && { name: body.name }), ...body.profile };
  const changed = APPLICANT_DETAILS.filter((k) => next[k] !== undefined && next[k] !== detailValue(user, k));
  if (!changed.length) return res.json(view(user.toObject() as StudentRecord));

  const before = Object.fromEntries(changed.map((k) => [k, detailValue(user, k) ?? null]));
  for (const k of changed) {
    if (k === 'name') user.name = next.name!;
    else user.set(`profile.${k}`, next[k]);
  }
  await user.save();
  const after = Object.fromEntries(changed.map((k) => [k, next[k]]));
  await audit(me, 'applicant.details_corrected', 'User', user._id, { before, after, reason: body.reason }, req.ip);
  await notify(user._id, 'profile_updated', `Your ${changed.map((k) => DETAIL_LABELS[k]).join(', ')} ${changed.length > 1 ? 'were' : 'was'} updated by the scholarship office: ${body.reason}`, '/profile');
  await applicantDetailsChanged(user._id);
  res.json(view(user.toObject() as StudentRecord));
});
