import { Router } from 'express';
import { z } from 'zod';
import { config, isProduction } from '../config.js';
import { DocumentTypeModel, ExtractionProfileModel } from '../models/document.js';
import { AuditEntryModel, DocumentAccessLogModel, SettingsModel, VERIFICATION_PROVIDER_IDS, getSettings } from '../models/system.js';
import { ROLES, UserModel } from '../models/user.js';
import { FACT_CATALOG } from '../domain/facts.js';
import { actor, parse, requireRole, paging, sendPage } from '../lib/http.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from '../lib/events.js';
import { hashPassword } from '../lib/crypto.js';
import { parseCsv } from '../lib/csv.js';
import { ocrClient } from '../ocr/client.js';
import { blobStore } from '../lib/storage.js';

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

admin.get('/users', async (req, res) => {
  const p = paging(req);
  const [items, total] = await Promise.all([UserModel.find().sort({ role: 1, name: 1, email: 1 }).skip(p.skip).limit(p.limit).lean(), p.paged ? UserModel.countDocuments() : undefined]);
  sendPage(res, p, items, total);
});

// Accounts are created with an email and an initial password; the person adds their name (and a student their
// applicant details) at first sign-in.
const userBody = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  role: z.enum(ROLES).default('student'),
  password: z.string().min(10, 'The initial password needs at least 10 characters').max(200),
});

admin.post('/users', async (req, res) => {
  const { password, ...body } = parse(userBody, req.body);
  if (await UserModel.exists({ email: body.email })) throw conflict(`An account for ${body.email} already exists`);
  const user = await UserModel.create({ ...body, passwordHash: hashPassword(password) });
  await audit(actor(req), 'user.created', 'User', user._id, { email: body.email, role: body.role });
  res.status(201).json({ id: user.id, email: user.email, role: user.role });
});

const MAX_IMPORT_ROWS = 1000;

/**
 * Creates many accounts from CSV text with the columns email, password and (optionally) role; role defaults to
 * student. Every row is validated first. With dryRun nothing is created, so the admin can review the result.
 * Existing emails are skipped, never overwritten.
 */
admin.post('/users/import', async (req, res) => {
  const me = actor(req);
  const { csv, dryRun } = parse(z.object({ csv: z.string().min(1, 'The CSV file is empty').max(500_000), dryRun: z.boolean().default(false) }), req.body);
  const [header, ...rows] = parseCsv(csv);
  const cols = (header ?? []).map((h) => h.toLowerCase());
  const at = { email: cols.indexOf('email'), password: cols.indexOf('password'), role: cols.indexOf('role') };
  if (at.email < 0 || at.password < 0) throw badRequest('The first row must name the columns: email, password and optionally role');
  if (rows.length > MAX_IMPORT_ROWS) throw badRequest(`At most ${MAX_IMPORT_ROWS} accounts per file; this one has ${rows.length}`);

  const seen = new Set<string>();
  const existing = new Set((await UserModel.find({ email: { $in: rows.map((r) => (r[at.email] ?? '').toLowerCase()) } }, 'email').lean()).map((u) => u.email));
  const report = rows.map((r, i) => {
    const line = i + 2; // spreadsheet row number, counting the header
    const email = (r[at.email] ?? '').toLowerCase();
    const parsed = userBody.safeParse({ email, password: r[at.password] ?? '', role: at.role >= 0 && r[at.role] ? r[at.role].toLowerCase() : undefined });
    if (!parsed.success) return { line, email, outcome: 'invalid' as const, reason: parsed.error.issues.map((x) => (x.path[0] === 'role' ? `Unknown role "${r[at.role]}"` : x.message)).join('; ') };
    if (seen.has(email)) return { line, email, outcome: 'invalid' as const, reason: 'Listed twice in this file' };
    seen.add(email);
    if (existing.has(email)) return { line, email, outcome: 'skipped' as const, reason: 'An account with this email already exists' };
    return { line, email, outcome: 'ready' as const, role: parsed.data.role, password: parsed.data.password };
  });

  if (!dryRun) {
    for (const row of report) {
      if (row.outcome !== 'ready') continue;
      await UserModel.create({ email: row.email, role: row.role, passwordHash: hashPassword(row.password!) });
      (row as { outcome: string }).outcome = 'created';
    }
  }
  const summary = Object.fromEntries(['ready', 'created', 'skipped', 'invalid'].map((o) => [o, report.filter((r) => r.outcome === o).length]));
  if (!dryRun) await audit(me, 'users.imported', 'User', 'bulk', summary, req.ip);
  // Passwords never leave the server again.
  res.json({ dryRun, summary, rows: report.map(({ password: _p, ...r }) => r) });
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
  const p = paging(req);
  const [items, total] = await Promise.all([
    AuditEntryModel.find(q).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).populate('actor', 'name email').lean(),
    p.paged ? AuditEntryModel.countDocuments(q) : undefined,
  ]);
  sendPage(res, p, items, total);
});

admin.get('/access-log', async (req, res) => {
  const p = paging(req);
  const [items, total] = await Promise.all([
    DocumentAccessLogModel.find().sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).populate('actor', 'name role').populate('document', 'originalName').lean(),
    p.paged ? DocumentAccessLogModel.countDocuments() : undefined,
  ]);
  sendPage(res, p, items, total);
});

admin.get('/health', async (_req, res) => {
  res.json({ ocr: await ocrClient().health(), storage: await blobStore().health() });
});
