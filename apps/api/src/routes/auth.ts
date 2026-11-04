import { Router } from 'express';
import { z } from 'zod';
import { ROLES, UserModel } from '../models/user.js';
import { NotificationModel } from '../models/system.js';
import { ApplicationModel } from '../models/scholarship.js';
import { FACT_CATALOG } from '../domain/facts.js';
import { jobQueue } from '../pipeline/queue.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { actor, authenticate, issueSession, parse, SESSION_COOKIE } from '../lib/http.js';
import { HttpError } from '../lib/errors.js';
import { audit } from '../lib/events.js';

export const auth = Router();

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1), role: z.enum(ROLES).optional() });

auth.post('/login', async (req, res) => {
  const body = parse(loginBody, req.body);
  const user = await UserModel.findOne({ email: body.email.toLowerCase() }).select('+passwordHash');
  // The role picked on the login screen must be the account's role. A mismatch gets the same answer as a
  // wrong password, so the form never reveals which role an email address belongs to.
  if (!user?.active || !verifyPassword(body.password, user.passwordHash) || (body.role && body.role !== user.role)) {
    throw new HttpError(401, 'invalid_credentials', 'Email, password or role is incorrect');
  }
  issueSession(res, { id: user.id, role: user.role });
  await audit({ id: user.id, role: user.role }, 'auth.login', 'User', user._id, undefined, req.ip);
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

auth.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' }).status(204).end();
});

auth.get('/me', authenticate, (req, res) => {
  res.json(actor(req));
});

auth.get('/me/profile', authenticate, async (req, res) => {
  const user = await UserModel.findById(actor(req).id).lean();
  res.json({ id: String(user!._id), name: user!.name, email: user!.email, role: user!.role, profile: user!.profile ?? {} });
});

// Allowed values come from the rule-fact catalog, the same list the eligibility rules use.
const oneOf = (fact: string) => z.string().refine((v) => FACT_CATALOG[fact].options!.includes(v), `Not a valid ${fact.split('.')[1]}`);
const profileBody = z
  .object({
    name: z.string().trim().min(2).max(100),
    profile: z
      .object({
        phone: z.string().trim().regex(/^(\+?[\d][\d\s-]{6,18})?$/, 'Enter a valid phone number'),
        category: oneOf('applicant.category'),
        gender: oneOf('applicant.gender'),
        state: z.string().trim().max(60),
      })
      .partial(),
  })
  .partial();

/**
 * People edit their own name and contact details. Applicant details (category, gender, state) are eligibility
 * facts, so only students have them, every change is audited, and their open applications are re-evaluated.
 */
auth.patch('/me/profile', authenticate, async (req, res) => {
  const me = actor(req);
  const body = parse(profileBody, req.body);
  const { phone, ...applicant } = body.profile ?? {};
  if (me.role !== 'student' && Object.keys(applicant).length) {
    throw new HttpError(403, 'forbidden', 'Only students have applicant details');
  }
  const user = await UserModel.findById(me.id);
  const before = { name: user!.name, profile: { ...user!.toObject().profile } };
  if (body.name !== undefined) user!.name = body.name;
  for (const [key, value] of Object.entries({ phone, ...applicant })) {
    if (value !== undefined) user!.set(`profile.${key}`, value === '' ? undefined : value);
  }
  await user!.save();
  await audit(me, 'profile.updated', 'User', user!._id, { before, after: body }, req.ip);

  if (Object.keys(applicant).length) {
    const open = await ApplicationModel.find({ student: user!._id, status: { $in: ['submitted', 'under_review', 'evaluated'] } }).select('_id').lean();
    for (const a of open) await jobQueue().add('application.evaluate', { applicationId: String(a._id) }, { jobId: `evaluate:${a._id}:${Date.now()}` });
  }
  res.json({ id: user!.id, name: user!.name, email: user!.email, role: user!.role, profile: user!.toObject().profile ?? {} });
});

const passwordBody = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(200) });

auth.post('/me/password', authenticate, async (req, res) => {
  const me = actor(req);
  const body = parse(passwordBody, req.body);
  const user = await UserModel.findById(me.id).select('+passwordHash');
  if (!verifyPassword(body.currentPassword, user!.passwordHash)) {
    throw new HttpError(400, 'wrong_password', 'Current password is incorrect');
  }
  if (body.currentPassword === body.newPassword) throw new HttpError(400, 'same_password', 'Choose a password different from the current one');
  user!.passwordHash = hashPassword(body.newPassword);
  await user!.save();
  await audit(me, 'password.changed', 'User', user!._id, undefined, req.ip);
  res.status(204).end();
});

auth.get('/me/notifications', authenticate, async (req, res) => {
  res.json(await NotificationModel.find({ user: actor(req).id }).sort({ createdAt: -1 }).limit(50).lean());
});

auth.post('/me/notifications/read', authenticate, async (req, res) => {
  await NotificationModel.updateMany({ user: actor(req).id, readAt: null }, { readAt: new Date() });
  res.status(204).end();
});
