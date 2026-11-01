import { pino } from 'pino';
import type { Types } from 'mongoose';
import { AuditEntryModel, NotificationModel, ProcessingTimelineModel } from '../models/system.js';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  // Session tokens must never reach logs.
  redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
});

export interface Actor {
  id: string;
  role: string;
}

type Id = string | Types.ObjectId;

export async function audit(actor: Actor | null, action: string, entity: string, entityId: Id, details?: unknown, ip?: string) {
  await AuditEntryModel.create({ actor: actor?.id, actorRole: actor?.role ?? 'system', action, entity, entityId: String(entityId), details, ip });
}

export async function timeline(entry: {
  document?: Id;
  application?: Id;
  stage: string;
  status: string;
  message?: string;
  durationMs?: number;
  actor?: string;
}) {
  await ProcessingTimelineModel.create(entry);
}

export const NOTIFICATION_TYPES = [
  'document_received',
  'processing_complete',
  'review_required',
  'additional_document_needed',
  'verification_outcome',
  'recommendation_issued',
  'award_decision',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * In-app notification plus outbound channels. Email/SMS transports sit behind this function;
 * delivery failures never block the pipeline — the in-app record is the source of truth.
 */
export async function notify(user: Id, type: NotificationType, message: string, link?: string) {
  await NotificationModel.create({ user, type, message, link, channels: ['in_app', 'email'] });
  logger.info({ user: String(user), type }, 'notification queued for email channel');
}
