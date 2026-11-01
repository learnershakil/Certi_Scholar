import { Schema, model, type InferSchemaType } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;

const ProcessingTimelineSchema = new Schema(
  {
    document: { type: ObjectId, ref: 'Document', index: true },
    application: { type: ObjectId, ref: 'Application', index: true },
    stage: { type: String, required: true },
    status: { type: String, required: true },
    message: String,
    durationMs: Number,
    actor: { type: ObjectId, ref: 'User' }, // null = system
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const AuditEntrySchema = new Schema(
  {
    actor: { type: ObjectId, ref: 'User' },
    actorRole: String,
    action: { type: String, required: true, index: true },
    entity: { type: String, required: true },
    entityId: { type: String, index: true },
    details: Mixed,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/** Separate, append-only log of every document content view (original or preview). */
const DocumentAccessLogSchema = new Schema(
  {
    document: { type: ObjectId, ref: 'Document', required: true, index: true },
    actor: { type: ObjectId, ref: 'User', required: true },
    actorRole: String,
    variant: String,
    ip: String,
    userAgent: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const NotificationSchema = new Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    message: { type: String, required: true },
    link: String,
    channels: [String],
    readAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const VERIFICATION_PROVIDER_IDS = ['simulated', 'registry', 'manual_only'] as const;

const SettingsSchema = new Schema(
  {
    _id: { type: String, default: 'global' },
    defaultConfidenceThreshold: { type: Number, default: 0.85, min: 0, max: 1 },
    classificationThreshold: { type: Number, default: 0.6, min: 0, max: 1 },
    percentageTolerance: { type: Number, default: 0.05, min: 0 },
    retentionDays: { type: Number, default: 365, min: 1 },
    verificationProvider: { type: String, enum: VERIFICATION_PROVIDER_IDS, default: 'manual_only' },
    registryBaseUrl: String,
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const ProcessingTimelineModel = model('ProcessingTimeline', ProcessingTimelineSchema);
export const AuditEntryModel = model('AuditEntry', AuditEntrySchema);
export const DocumentAccessLogModel = model('DocumentAccessLog', DocumentAccessLogSchema);
export const NotificationModel = model('Notification', NotificationSchema);
export const SettingsModel = model('Settings', SettingsSchema);

export type Settings = InferSchemaType<typeof SettingsSchema>;

export async function getSettings(): Promise<Settings> {
  const s = await SettingsModel.findById('global').lean();
  return s ?? (await SettingsModel.create({ _id: 'global' })).toObject();
}
