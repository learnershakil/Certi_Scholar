import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { z } from 'zod';
import { config } from '../config.js';
import { UserModel, type Role } from '../models/user.js';
import { badRequest, forbidden, HttpError } from './errors.js';
import type { Actor } from './events.js';

export const SESSION_COOKIE = 'cs_session';

declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor & { name: string; email: string };
  }
}

export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw badRequest('Validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export function issueSession(res: Response, user: { id: string; role: string }) {
  const token = jwt.sign({ sub: user.id, role: user.role }, config().JWT_SECRET, { expiresIn: '8h' });
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: config().NODE_ENV === 'production', maxAge: 8 * 3600_000, path: '/' });
}

/** Resolves the session on every request so a deactivated user or changed role takes effect immediately. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = req.cookies?.[SESSION_COOKIE] ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
  if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in required');
  let sub: string;
  try {
    sub = (jwt.verify(token, config().JWT_SECRET) as { sub: string }).sub;
  } catch {
    throw new HttpError(401, 'unauthenticated', 'Session expired');
  }
  const user = await UserModel.findById(sub).lean();
  if (!user?.active) throw new HttpError(401, 'unauthenticated', 'Account inactive');
  req.actor = { id: String(user._id), role: user.role, name: user.name, email: user.email };
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.actor || !roles.includes(req.actor.role as Role)) throw forbidden();
    next();
  };

export const actor = (req: Request) => req.actor!;

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  const e = err as { name?: string; code?: string | number; message?: string };
  if (e.name === 'MulterError') {
    res.status(e.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: { code: 'upload_rejected', message: e.message } });
    return;
  }
  if (e.name === 'CastError') {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
    return;
  }
  if (e.code === 11000) {
    res.status(409).json({ error: { code: 'conflict', message: 'Already exists' } });
    return;
  }
  _req.log?.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
}
