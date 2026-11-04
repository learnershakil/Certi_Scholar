import { Router } from 'express';
import { z } from 'zod';
import { config, isProduction } from '../config.js';
import { DocumentTypeModel, ExtractionProfileModel } from '../models/document.js';
import { AuditEntryModel, DocumentAccessLogModel, SettingsModel, VERIFICATION_PROVIDER_IDS, getSettings } from '../models/system.js';
import { ROLES, UserModel } from '../models/user.js';
import { FACT_CATALOG } from '../domain/facts.js';
import { actor, parse, requireRole } from '../lib/http.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from '../lib/events.js';
import { hashPassword } from '../lib/crypto.js';
import { ocrClient } from '../ocr/client.js';

export const admin = Router();
admin.use(requireRole('admin'));

admin.get('/settings', async (_req, res) => {
  res.json({ ...(await getSettings()), environment: isProduction() ? 'production' : 'non-production', simulatedProviderAllowed: !isProduction() });
});

const settingsBody = z.object({
  defaultConfidenceThreshold: z.number().min(0.5).max(1),
  classificationThreshold: z.number().min(0.3).max(1),
  percentageTolerance: z.number().min(0).max(1),
  retentionDays: z.number().int().min(30).max(3650),
  classificationMargin: z.number().min(0).max(0.5),
  unreadableLineConfidence: z.number().min(0).max(1),
  certificateValidityDays: z.number().int().min(1).max(3650),
  minPlausibleAge: z.number().int().min(0).max(120),
  branding: z.object({
    appName: z.string().trim().min(1).max(60),
    eyebrow: z.string().max(120),
    headline: z.string().max(160),
    lead: z.string().max(400),
    points: z.array(z.string().max(160)).max(6),
    footnote: z.string().max(200),
    passwordHelp: z.string().max(200),
  }).partial(),
  roleLabels: z.record(z.string().refine((r) => (ROLES as readonly string[]).includes(r), 'Unknown role'), z.string().trim().min(1).max(40)),
  factText: z.record(z.string().refine((k) => k in FACT_CATALOG, 'Unknown fact'), z.object({ label: z.string().trim().min(1).max(80), description: z.string().max(240) })),
  maxPlausibleAge: z.number().int().min(1).max(150),
  verificationProvider: z.enum(VERIFICATION_PROVIDER_IDS),
  registryBaseUrl: z.string().url().optional().or(z.literal('')),
}).partial();

admin.put('/settings', async (req, res) => {
  const me = actor(req);
  const body = parse(settingsBody, req.body);
  if (body.verificationProvider === 'simulated' && isProduction()) {
    throw conflict('The simulated verification provider is blocked in production configuration');
  }
  const before = await getSettings();
  // Branding is saved field by field so changing one line of wording keeps the rest.
  const { branding, roleLabels, factText, ...rest } = body;
  const brandingPaths = Object.fromEntries(Object.entries(branding ?? {}).map(([k, v]) => [`branding.${k}`, v]));
  // Label maps are merged with what is saved, so a request naming one role or fact leaves the others as they are.
  const merged = {
    ...(roleLabels && { roleLabels: { ...(before.roleLabels as object), ...roleLabels } }),
    ...(factText && { factText: { ...(before.factText as object), ...factText } }),
  };
  const updated = await SettingsModel.findByIdAndUpdate('global', { $set: { ...rest, ...brandingPaths, ...merged, updatedBy: me.id } }, { returnDocument: 'after', upsert: true }).lean();
  await audit(me, 'settings.updated', 'Settings', 'global', { before, after: body });
  res.json(updated);
});

admin.get('/users', async (_req, res) => {
  res.json(await UserModel.find().sort({ role: 1, name: 1 }).lean());
});

const userBody = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  role: z.enum(ROLES),
  password: z.string().min(10),
  profile: z.object({ category: z.enum(['GEN', 'EWS', 'OBC', 'SC', 'ST']).optional(), gender: z.enum(['female', 'male', 'other']).optional(), state: z.string().optional() }).optional(),
});

admin.post('/users', async (req, res) => {
  const { password, ...body } = parse(userBody, req.body);
  const user = await UserModel.create({ ...body, passwordHash: hashPassword(password) });
  await audit(actor(req), 'user.created', 'User', user._id, { email: body.email, role: body.role });
  res.status(201).json({ id: user.id, email: user.email, role: user.role });
});

admin.patch('/users/:id', async (req, res) => {
  const me = actor(req);
  const body = parse(z.object({ role: z.enum(ROLES), active: z.boolean() }).partial(), req.body);
  if (req.params.id === me.id && (body.active === false || (body.role && body.role !== 'admin'))) throw conflict('You cannot remove your own admin access');
  const user = await UserModel.findByIdAndUpdate(req.params.id, body, { returnDocument: 'after' }).lean();
  if (!user) throw notFound('User');
  await audit(me, 'user.access_changed', 'User', user._id, body);
  res.json(user);
});

admin.get('/document-types', async (_req, res) => {
  res.json(await DocumentTypeModel.find().lean());
});

admin.get('/profiles', async (_req, res) => {
  res.json(await ExtractionProfileModel.find({ active: true }).sort({ documentType: 1, format: 1 }).lean());
});

const profileBody = z.object({
  fields: z.array(
    z.object({
      key: z.string().regex(/^[a-z_]+$/),
      label: z.string().min(1),
      kind: z.enum(['text', 'number', 'date', 'id']),
      pattern: z.string().min(1),
      required: z.boolean(),
      threshold: z.number().min(0).max(1).nullable().optional(),
    }),
  ),
  table: z
    .object({ key: z.string(), label: z.string(), rowPattern: z.string(), columns: z.array(z.object({ key: z.string(), kind: z.enum(['text', 'number']), fixed: z.string().optional() })) })
    .nullable()
    .optional(),
});

/** Publishes a new version of one format's profile; earlier versions stay for reproducibility. */
admin.put('/profiles/:documentType/:format', async (req, res) => {
  const { documentType, format } = req.params;
  const me = actor(req);
  const body = parse(profileBody, req.body);
  for (const p of [...body.fields.map((f) => f.pattern), body.table?.rowPattern].filter(Boolean) as string[]) {
    try {
      new RegExp(p);
    } catch {
      throw badRequest(`Invalid pattern: ${p}`);
    }
  }
  const latest = await ExtractionProfileModel.findOne({ documentType, format }).sort({ version: -1 });
  if (!latest) throw notFound('Extraction profile');
  await ExtractionProfileModel.updateMany({ documentType, format }, { active: false });
  const profile = await ExtractionProfileModel.create({ documentType, format, name: latest.name, version: latest.version + 1, fields: body.fields, table: body.table ?? undefined, createdBy: me.id });
  await audit(me, 'profile.published', 'ExtractionProfile', profile._id, { documentType, format, version: profile.version });
  res.status(201).json(profile);
});

admin.get('/audit', async (req, res) => {
  const q: Record<string, unknown> = {};
  if (typeof req.query.action === 'string' && req.query.action) q.action = req.query.action;
  if (typeof req.query.entityId === 'string' && req.query.entityId) q.entityId = req.query.entityId;
  res.json(await AuditEntryModel.find(q).sort({ createdAt: -1 }).limit(config().LIST_PAGE_SIZE).populate('actor', 'name email').lean());
});

admin.get('/access-log', async (_req, res) => {
  res.json(await DocumentAccessLogModel.find().sort({ createdAt: -1 }).limit(config().LIST_PAGE_SIZE).populate('actor', 'name role').populate('document', 'originalName').lean());
});

admin.get('/health', async (_req, res) => {
  res.json({ ocr: await ocrClient().health() });
});
