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
  const hours = config().SESSION_TTL_HOURS;
  const token = jwt.sign({ sub: user.id, role: user.role }, config().JWT_SECRET, { expiresIn: `${hours}h` });
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: config().NODE_ENV === 'production', maxAge: hours * 3600_000, path: '/' });
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
  req.actor = { id: String(user._id), role: user.role, name: user.name ?? '', email: user.email };
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
    const tooLarge = e.code === 'LIMIT_FILE_SIZE';
    const message = tooLarge
      ? `This file is larger than the ${(config().MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB limit. Compress it or scan it at a lower resolution, then upload again.`
      : e.code === 'LIMIT_FILE_COUNT' || e.code === 'LIMIT_UNEXPECTED_FILE' ? 'Upload one file at a time.' : e.message;
    res.status(tooLarge ? 413 : 400).json({ error: { code: tooLarge ? 'file_too_large' : 'upload_rejected', message } });
    return;
  }
  // The connection closed before the whole file arrived (network drop, page closed, or a proxy limit).
  if (e.message === 'Request aborted' || e.code === 'ECONNRESET') {
    if (!res.headersSent) res.status(400).json({ error: { code: 'upload_interrupted', message: 'The upload was interrupted before the whole file arrived. Check your connection and try again.' } });
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

/**
 * Optional paging for list endpoints. Without ?page the list is returned as before (up to LIST_PAGE_SIZE, for
 * callers that need everything, such as dashboard counters). With ?page=N (&pageSize, default 25) only that page is
 * returned and the total is sent in X-Total-Count, so the body stays a plain array.
 */
export function paging(req: Request) {
  const max = config().LIST_PAGE_SIZE;
  const page = Math.floor(Number(req.query.page));
  if (!(page >= 1)) return { paged: false as const, skip: 0, limit: max };
  const size = Math.min(max, Math.max(1, Math.floor(Number(req.query.pageSize)) || 25));
  return { paged: true as const, page, size, skip: (page - 1) * size, limit: size };
}

export function sendPage<T>(res: Response, p: ReturnType<typeof paging>, items: T[], total?: number) {
  if (p.paged) res.set({ 'X-Total-Count': String(total ?? items.length), 'X-Page': String(p.page), 'X-Page-Size': String(p.size) });
  res.json(items);
}
