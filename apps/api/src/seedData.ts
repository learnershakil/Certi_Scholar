import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './config.js';
import { DocumentTypeModel, ExtractionProfileModel } from './models/document.js';
import { ScholarshipModel, ScholarshipRuleModel } from './models/scholarship.js';
import { SettingsModel } from './models/system.js';
import { UserModel, type Role } from './models/user.js';
import { hashPassword } from './lib/crypto.js';
import { withoutRetiredFacts, type RuleNode } from './domain/rules.js';

/**
 * Seed data lives in JSON files under SEED_DIR (default apps/api/seed), not in code:
 *   document-types.json        types and their classification keywords
 *   extraction-profiles.json   one profile per document type and format
 *   scholarships.json          scholarships with their first rule set and officers (by email)
 *   demo-users.json            demo accounts, created only when SEED_DEMO=true (never in production)
 *   settings.json              product name, sign-in page wording, role names and rule-fact labels
 * Seeding only creates what is missing; anything an administrator has since edited in the app is left alone.
 */
const load = <T>(file: string): T => JSON.parse(readFileSync(join(resolve(config().SEED_DIR), file), 'utf8')) as T;

interface DocumentTypeSeed { code: string; name: string; keywords: Array<{ term: string; weight: number }> }
interface ProfileSeed { documentType: string; format: string; name: string; version: number; fields: Array<Record<string, unknown>>; table?: Record<string, unknown> }
interface ScholarshipSeed { code: string; name: string; officers: string[]; rule: RuleNode; requiredDocuments: string[]; [key: string]: unknown }
interface UserSeed { email: string; name: string; role: Role; profile?: Record<string, string> }

export const DOCUMENT_TYPES = load<DocumentTypeSeed[]>('document-types.json');
export const EXTRACTION_PROFILES = load<ProfileSeed[]>('extraction-profiles.json');
export const SCHOLARSHIPS = load<ScholarshipSeed[]>('scholarships.json');
export const RULES: Record<string, RuleNode> = Object.fromEntries(SCHOLARSHIPS.map((s) => [s.code, s.rule]));
export const SETTINGS_DEFAULTS = load<Record<string, unknown>>('settings.json');

export async function seedReferenceData(opts: { verificationProvider?: string } = {}) {
  for (const t of DOCUMENT_TYPES) {
    await DocumentTypeModel.updateOne({ code: t.code }, { $setOnInsert: t }, { upsert: true });
  }
  // Profiles created before formats existed are the 'standard' format; then rebuild indexes for (type, format, version).
  await ExtractionProfileModel.updateMany({ format: { $exists: false } }, { $set: { format: 'standard' } });
  await ExtractionProfileModel.syncIndexes();
  for (const p of EXTRACTION_PROFILES) {
    if (!(await ExtractionProfileModel.exists({ documentType: p.documentType, format: p.format }))) await ExtractionProfileModel.create(p);
  }
  await SettingsModel.updateOne({ _id: 'global' }, { $setOnInsert: { verificationProvider: opts.verificationProvider ?? 'manual_only' } }, { upsert: true });
  for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
    await SettingsModel.updateOne({ _id: 'global', [key]: { $exists: false } }, { $set: { [key]: value } });
  }
}

export async function seedDemoUsers(password: string) {
  for (const u of load<UserSeed[]>('demo-users.json')) {
    if (!(await UserModel.exists({ email: u.email }))) await UserModel.create({ ...u, passwordHash: hashPassword(password) });
  }
}

/** Creates missing scholarships and their first rule version; officers are linked by email when those accounts exist. */
export async function seedScholarships() {
  for (const { rule, officers, ...s } of SCHOLARSHIPS) {
    const officerIds = (await UserModel.find({ email: { $in: officers } }).select('_id').lean()).map((u) => u._id);
    const sch = await ScholarshipModel.findOneAndUpdate({ code: s.code }, { $setOnInsert: { ...s, officers: officerIds } }, { upsert: true, returnDocument: 'after' });
    if (!sch.officers.length && officerIds.length) await ScholarshipModel.updateOne({ _id: sch._id }, { officers: officerIds });
    if (!(await ScholarshipRuleModel.exists({ scholarship: sch._id }))) {
      await ScholarshipRuleModel.create({ scholarship: sch._id, version: 1, root: rule, changeNote: 'Initial rule set' });
    }
  }
}

/**
 * Facts removed from the catalog (such as the applicant category) must not linger: live rules that use one get a new
 * version without it (earlier versions stay, so past recommendations remain reproducible), and stored profiles drop
 * the value. Runs on every start and does nothing once the data is clean.
 */
export async function retireRemovedFacts() {
  for (const rule of await ScholarshipRuleModel.find({ active: true }).lean()) {
    const root = rule.root as unknown as RuleNode;
    const pruned = withoutRetiredFacts(root);
    if (pruned && JSON.stringify(pruned) !== JSON.stringify(root)) {
      await ScholarshipRuleModel.updateMany({ scholarship: rule.scholarship }, { active: false });
      await ScholarshipRuleModel.create({ scholarship: rule.scholarship, version: rule.version + 1, root: pruned, changeNote: 'Removed conditions on facts that are no longer collected (applicant category)' });
    }
  }
  // The schema no longer has the field, so go to the collection directly.
  await UserModel.collection.updateMany({ 'profile.category': { $exists: true } }, { $unset: { 'profile.category': '' } });
}

/** Full development seed: reference data, demo accounts (password from SEED_DEMO_PASSWORD) and scholarships. */
export async function seedDemo() {
  const password = config().SEED_DEMO_PASSWORD;
  if (!password) throw new Error('SEED_DEMO_PASSWORD is not set');
  await seedReferenceData({ verificationProvider: 'simulated' });
  await seedDemoUsers(password);
  await seedScholarships();
}
