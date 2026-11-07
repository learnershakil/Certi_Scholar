import { Router } from 'express';
import { z } from 'zod';
import { ROLES, UserModel } from '../models/user.js';
import { NotificationModel } from '../models/system.js';
import { FACT_CATALOG } from '../domain/facts.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { actor, authenticate, issueSession, parse, SESSION_COOKIE } from '../lib/http.js';
import { HttpError } from '../lib/errors.js';
import { audit } from '../lib/events.js';
import { APPLICANT_DETAILS, DETAIL_LABELS, applicantDetailsChanged, detailValue, profileComplete, type ApplicantDetail } from '../services/applicantDetails.js';

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
  const firstLogin = !user.lastLoginAt;
  user.lastLoginAt = new Date();
  await user.save();
  issueSession(res, { id: user.id, role: user.role });
  await audit({ id: user.id, role: user.role }, 'auth.login', 'User', user._id, firstLogin ? { firstLogin } : undefined, req.ip);
  res.json({ id: user.id, name: user.name ?? null, email: user.email, role: user.role, firstLogin, profileComplete: profileComplete(user) });
});

auth.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' }).status(204).end();
});

auth.get('/me', authenticate, async (req, res) => {
  const me = actor(req);
  const user = await UserModel.findById(me.id).lean();
  res.json({ ...me, profileComplete: profileComplete(user!) });
});

auth.get('/me/profile', authenticate, async (req, res) => {
  const user = await UserModel.findById(actor(req).id).lean();
  res.json({ id: String(user!._id), name: user!.name ?? null, email: user!.email, role: user!.role, profile: user!.profile ?? {}, profileComplete: profileComplete(user!) });
});

// Allowed values come from the rule-fact catalog, the same list the eligibility rules use.
const oneOf = (fact: string) => z.string().refine((v) => v === '' || FACT_CATALOG[fact].options!.includes(v), `Not a valid ${fact.split('.')[1]}`);
const personName = z.string().trim().max(100).regex(/^([\p{L} .'-]{2,})?$/u, 'Use letters, spaces, dots and apostrophes only');
const profileBody = z
  .object({
    name: personName,
    profile: z
      .object({
        phone: z.string().trim().regex(/^(\+?[\d][\d\s-]{6,18})?$/, 'Enter a valid phone number'),
        fatherName: personName,
        motherName: personName,
        gender: oneOf('applicant.gender'),
        state: z.string().trim().max(60),
      })
      .partial(),
  })
  .partial();

/**
 * People keep their own name and phone up to date. A student's applicant details (name, parents' names, gender,
 * state) are entered once and then fixed: only a verification officer or administrator can change them
 * (PATCH /students/:id), so eligibility and document matching cannot be adjusted by editing the profile.
 */
auth.patch('/me/profile', authenticate, async (req, res) => {
  const me = actor(req);
  const body = parse(profileBody, req.body);
  const { phone, ...rest } = body.profile ?? {};
  const student = me.role === 'student';
  if (!student && Object.values(rest).some((v) => v !== undefined)) throw new HttpError(403, 'forbidden', 'Only students have applicant details');
  const user = await UserModel.findById(me.id);
  const next: Partial<Record<ApplicantDetail, string>> = { ...(body.name !== undefined && { name: body.name }), ...rest };
  for (const k of APPLICANT_DETAILS) {
    if (next[k] === undefined) continue;
    if (next[k] === '') throw new HttpError(400, 'bad_request', `Enter your ${DETAIL_LABELS[k]}`);
    const current = detailValue(user!, k);
    if (student && current && next[k] !== current) {
      throw new HttpError(409, 'locked', `Your ${DETAIL_LABELS[k]} is already set. Only a verification officer or administrator can change it.`);
    }
  }
  const changed = APPLICANT_DETAILS.filter((k) => next[k] !== undefined && next[k] !== detailValue(user!, k));
  const before = Object.fromEntries(changed.map((k) => [k, detailValue(user!, k) ?? null]));
  for (const k of changed) {
    if (k === 'name') user!.name = next.name!;
    else user!.set(`profile.${k}`, next[k]);
  }
  if (phone !== undefined) user!.set('profile.phone', phone === '' ? undefined : phone);
  await user!.save();
  await audit(me, 'profile.updated', 'User', user!._id, { before, after: Object.fromEntries(changed.map((k) => [k, next[k]])), phone: phone !== undefined }, req.ip);
  if (student && changed.length) await applicantDetailsChanged(user!._id);
  res.json({ id: user!.id, name: user!.name ?? null, email: user!.email, role: user!.role, profile: user!.toObject().profile ?? {}, profileComplete: profileComplete(user!) });
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
