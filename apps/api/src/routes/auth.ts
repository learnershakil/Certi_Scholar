import { Router } from 'express';
import { z } from 'zod';
import { UserModel } from '../models/user.js';
import { NotificationModel } from '../models/system.js';
import { verifyPassword } from '../lib/crypto.js';
import { actor, authenticate, issueSession, parse, SESSION_COOKIE } from '../lib/http.js';
import { HttpError } from '../lib/errors.js';
import { audit } from '../lib/events.js';

export const auth = Router();

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

auth.post('/login', async (req, res) => {
  const body = parse(loginBody, req.body);
  const user = await UserModel.findOne({ email: body.email.toLowerCase() }).select('+passwordHash');
  if (!user?.active || !verifyPassword(body.password, user.passwordHash)) {
    throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
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

auth.get('/me/notifications', authenticate, async (req, res) => {
  res.json(await NotificationModel.find({ user: actor(req).id }).sort({ createdAt: -1 }).limit(50).lean());
});

auth.post('/me/notifications/read', authenticate, async (req, res) => {
  await NotificationModel.updateMany({ user: actor(req).id, readAt: null }, { readAt: new Date() });
  res.status(204).end();
});
