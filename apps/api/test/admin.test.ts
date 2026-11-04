import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfig } from '../src/config.js';
import { ScholarshipRuleModel } from '../src/models/scholarship.js';
import { startHarness, type Harness } from './helpers.js';

let h: Harness;
let admin: Awaited<ReturnType<Harness['login']>>;
let officer: Awaited<ReturnType<Harness['login']>>;
let scholarshipId: string;

beforeAll(async () => {
  h = await startHarness();
  [admin, officer] = await Promise.all([h.login('admin'), h.login('officer')]);
  scholarshipId = (await admin.get('/api/v1/scholarships').expect(200)).body.find((s: { code: string }) => s.code === 'MCM-2026')._id;
});
afterAll(() => h.stop());

const rule = {
  type: 'group',
  op: 'AND',
  children: [
    { type: 'condition', fact: 'marksheet.percentage', operator: 'gte', value: 70 },
    { type: 'group', op: 'OR', children: [
      { type: 'condition', fact: 'income.annualIncome', operator: 'lte', value: 300000 },
      { type: 'condition', fact: 'applicant.category', operator: 'in', value: ['SC', 'ST'] },
    ] },
  ],
};

describe('no-code rule management', () => {
  it('exposes the fact catalog for the builder', async () => {
    const { facts, operators } = (await admin.get('/api/v1/scholarships/facts').expect(200)).body;
    expect(Object.keys(facts)).toContain('income.annualIncome');
    expect(operators).toContain('between');
  });

  it('evaluates a hypothetical applicant in the test harness without saving', async () => {
    const before = await ScholarshipRuleModel.countDocuments();
    const res = await admin
      .post('/api/v1/scholarships/rules/test')
      .send({ root: rule, facts: { 'marksheet.percentage': 72, 'income.annualIncome': 900000, 'applicant.category': 'ST' } })
      .expect(200);
    expect(res.body.outcome).toBe('pass');
    expect(res.body.children[1].children.map((c: { outcome: string }) => c.outcome)).toEqual(['fail', 'pass']);
    expect(await ScholarshipRuleModel.countDocuments()).toBe(before);
  });

  it('publishes a new version and deactivates the old one, with no deployment', async () => {
    const res = await admin.put(`/api/v1/scholarships/${scholarshipId}/rules`).send({ root: rule, changeNote: 'Raise threshold to 70%' }).expect(201);
    expect(res.body.version).toBe(2);
    const versions = (await admin.get(`/api/v1/scholarships/${scholarshipId}/rules`).expect(200)).body;
    expect(versions.map((v: { version: number; active: boolean }) => [v.version, v.active])).toEqual([[2, true], [1, false]]);
  });

  it('rejects invalid rules with specific problems', async () => {
    const res = await admin
      .put(`/api/v1/scholarships/${scholarshipId}/rules`)
      .send({ root: { type: 'condition', fact: 'marksheet.consistent', operator: 'gte', value: 1 }, changeNote: 'bad' })
      .expect(400);
    expect(res.body.error.details[0]).toMatch(/not valid for boolean/);
  });

  it('restricts rule management to administrators', async () => {
    await officer.put(`/api/v1/scholarships/${scholarshipId}/rules`).send({ root: rule, changeNote: 'nope' }).expect(403);
    await officer.post('/api/v1/scholarships/rules/test').send({ root: rule, facts: {} }).expect(403);
    await officer.get('/api/v1/scholarships/rules').expect(200);
  });

  it('creates a scholarship', async () => {
    const res = await admin.post('/api/v1/scholarships').send({ code: 'HOSTEL-26', name: 'Hostel Fee Waiver', requiredDocuments: ['income_certificate'] }).expect(201);
    expect(res.body.active).toBe(true);
    await admin.post('/api/v1/scholarships').send({ code: 'HOSTEL-26', name: 'Duplicate' }).expect(409);
  });
});

describe('administration', () => {
  it('updates thresholds with audit', async () => {
    await admin.put('/api/v1/admin/settings').send({ defaultConfidenceThreshold: 0.2 }).expect(400);
    const res = await admin.put('/api/v1/admin/settings').send({ defaultConfidenceThreshold: 0.9, retentionDays: 400 }).expect(200);
    expect(res.body).toMatchObject({ defaultConfidenceThreshold: 0.9, retentionDays: 400 });
    const audit = (await admin.get('/api/v1/admin/audit?action=settings.updated').expect(200)).body;
    expect(audit).toHaveLength(1);
  });

  it('blocks enabling the simulated provider in production', async () => {
    Object.assign(process.env, { NODE_ENV: 'production', QUEUE_DRIVER: 'bullmq', MALWARE_SCANNER: 'clamav', SEED_DEMO: 'false' });
    resetConfig();
    try {
      const res = await admin.put('/api/v1/admin/settings').send({ verificationProvider: 'simulated' }).expect(409);
      expect(res.body.error.message).toMatch(/blocked in production/);
      expect((await admin.get('/api/v1/admin/settings').expect(200)).body.simulatedProviderAllowed).toBe(false);
    } finally {
      Object.assign(process.env, { NODE_ENV: 'test', QUEUE_DRIVER: 'inline', MALWARE_SCANNER: 'signature', SEED_DEMO: 'true' });
      resetConfig();
    }
  });

  it('publishes a new extraction profile version and validates patterns', async () => {
    const [profile] = (await admin.get('/api/v1/admin/profiles').expect(200)).body.filter((p: { documentType: string }) => p.documentType === 'identity');
    const fields = profile.fields.map((f: Record<string, unknown>) => ({ ...f, threshold: f.threshold ?? null }));
    await admin.put('/api/v1/admin/profiles/identity/standard').send({ fields: [{ ...fields[0], pattern: '(' }] }).expect(400);
    const res = await admin.put('/api/v1/admin/profiles/identity/standard').send({ fields }).expect(201);
    expect(res.body.version).toBe(2);
  });

  it('manages user access and prevents self-lockout', async () => {
    const created = (await admin.post('/api/v1/admin/users').send({ email: 'new.verifier@example.test', name: 'New Verifier', role: 'verifier', password: 'LongEnough#2026' }).expect(201)).body;
    await admin.patch(`/api/v1/admin/users/${created.id}`).send({ active: false }).expect(200);
    const me = (await admin.get('/api/v1/auth/me')).body;
    await admin.patch(`/api/v1/admin/users/${me.id}`).send({ active: false }).expect(409);
    await officer.get('/api/v1/admin/users').expect(403);
  });

  it('reports OCR service health', async () => {
    expect((await admin.get('/api/v1/admin/health').expect(200)).body.ocr.ok).toBe(true);
  });
});
