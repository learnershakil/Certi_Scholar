import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { classify } from '../src/domain/extraction.js';
import { checkIdentity, checkIncomeCertificate, runConsistencyChecks } from '../src/domain/consistency.js';
import { DOCUMENT_TYPES, EXTRACTION_PROFILES, RULES, SCHOLARSHIPS } from '../src/seedData.js';
import { startHarness, type Harness } from './helpers.js';

const base = { JWT_SECRET: 'j'.repeat(32), PRESIGN_SECRET: 'p'.repeat(32), STORAGE_KEY: randomBytes(32).toString('base64') };

describe('environment configuration', () => {
  it('has defaults for every operational setting', () => {
    expect(loadConfig(base)).toMatchObject({
      SESSION_TTL_HOURS: 8,
      JOB_ATTEMPTS: 3,
      JOB_BACKOFF_MS: 5000,
      OCR_CONCURRENCY: 4,
      WORKER_CONCURRENCY: 8,
      RETENTION_CRON: '0 2 * * *',
      LIST_PAGE_SIZE: 200,
      SEED_DEMO: false,
    });
  });

  it('reads overrides from the environment', () => {
    expect(loadConfig({ ...base, SESSION_TTL_HOURS: '2', JOB_ATTEMPTS: '5', SEED_DIR: '/etc/seed' })).toMatchObject({ SESSION_TTL_HOURS: 2, JOB_ATTEMPTS: 5, SEED_DIR: '/etc/seed' });
  });

  it('requires a demo password when demo seeding is on, and refuses demo seeding in production', () => {
    expect(() => loadConfig({ ...base, SEED_DEMO: 'true' })).toThrow(/SEED_DEMO_PASSWORD/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', SEED_DEMO: 'true', SEED_DEMO_PASSWORD: 'long-enough-1' })).toThrow(/never created in production/);
  });

  it('rejects out-of-range values with the variable name', () => {
    expect(() => loadConfig({ ...base, JOB_ATTEMPTS: '0' })).toThrow(/JOB_ATTEMPTS/);
    expect(() => loadConfig({ ...base, SESSION_TTL_HOURS: '500' })).toThrow(/SESSION_TTL_HOURS/);
  });
});

describe('seed files', () => {
  it('load the reference data from JSON', () => {
    expect(DOCUMENT_TYPES.map((t) => t.code).sort()).toEqual(['identity', 'income_certificate', 'marksheet']);
    expect(EXTRACTION_PROFILES.map((p) => `${p.documentType}/${p.format}`)).toContain('marksheet/icse-class-x');
    expect(SCHOLARSHIPS.map((s) => s.code)).toEqual(['MCM-2026', 'GSTEM-2026']);
    expect(RULES['MCM-2026'].type).toBe('group');
  });
});

describe('tuning values passed in from settings', () => {
  it('classification margin decides when a near-tie goes to an officer', () => {
    const types = [
      { code: 'a', keywords: [{ term: 'alpha', weight: 1 }] },
      { code: 'b', keywords: [{ term: 'alpha', weight: 1 }, { term: 'beta', weight: 1 }] },
    ];
    expect(classify('alpha', types, 0.4, 0.6).documentType).toBeNull(); // 1.0 vs 0.5: lead 0.5 < 0.6
    expect(classify('alpha', types, 0.4, 0.4).documentType).toBe('a');
  });

  it('certificate validity and plausible ages come from settings', () => {
    const now = new Date('2026-11-04');
    expect(checkIncomeCertificate({ annual_income: '1', issue_date: '01/01/2026' }, now, 400)[1].status).toBe('pass');
    expect(checkIncomeCertificate({ annual_income: '1', issue_date: '01/01/2026' }, now, 200)[1].status).toBe('fail');
    expect(checkIdentity({ date_of_birth: '01/01/2018' }, now, { min: 5, max: 100 })[1].status).toBe('pass');
    expect(runConsistencyChecks('identity', { date_of_birth: '01/01/2018' }, 0.05, { minPlausibleAge: 10 })[1].status).toBe('fail');
  });
});

describe('document types and settings over the API', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.stop());

  it('lists active document types for every signed-in role', async () => {
    const student = await h.login('student');
    const types = (await student.get('/api/v1/document-types').expect(200)).body;
    expect(types).toEqual(expect.arrayContaining([{ code: 'marksheet', name: 'Statement of Marks' }]));
  });

  it('validates required documents against the stored types', async () => {
    const admin = await h.login('admin');
    await admin.post('/api/v1/scholarships').send({ code: 'BAD-1', name: 'Bad type', requiredDocuments: ['passport'] }).expect(400);
    await admin.post('/api/v1/scholarships').send({ code: 'OK-1', name: 'Good type', requiredDocuments: ['identity'] }).expect(201);
  });

  it('returns defaults for settings that predate them and saves edits', async () => {
    const admin = await h.login('admin');
    const before = (await admin.get('/api/v1/admin/settings').expect(200)).body;
    expect(before).toMatchObject({ classificationMargin: 0.15, unreadableLineConfidence: 0.5, certificateValidityDays: 366, minPlausibleAge: 10, maxPlausibleAge: 100 });
    await admin.put('/api/v1/admin/settings').send({ certificateValidityDays: 180 }).expect(200);
    expect((await admin.get('/api/v1/admin/settings').expect(200)).body.certificateValidityDays).toBe(180);
  });
});

describe('branding and labels', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.stop());

  it('serves branding and role names without signing in', async () => {
    const res = await request(h.app).get('/api/v1/branding').expect(200);
    expect(res.body.branding.appName).toBe('CertiScholar');
    expect(res.body.branding.points).toHaveLength(3);
    expect(res.body.roleLabels.verifier).toBe('Verification officer');
    expect(Object.keys(res.body)).toEqual(['branding', 'roleLabels']); // nothing else is public
  });

  it('changes one line of wording without losing the rest', async () => {
    const admin = await h.login('admin');
    await admin.put('/api/v1/admin/settings').send({ branding: { appName: 'Scholar Desk' }, roleLabels: { student: 'Applicant' } }).expect(200);
    const { body } = await request(h.app).get('/api/v1/branding').expect(200);
    expect(body.branding).toMatchObject({ appName: 'Scholar Desk', headline: 'Read every document. Explain every decision.' });
    expect(body.roleLabels.student).toBe('Applicant');
  });

  it('uses edited fact labels in the rule builder and in explanations', async () => {
    const admin = await h.login('admin');
    const { body: s } = await admin.get('/api/v1/admin/settings').expect(200);
    const factText = { ...s.factText, 'income.annualIncome': { label: 'Household income', description: 'Per year' } };
    await admin.put('/api/v1/admin/settings').send({ factText }).expect(200);
    expect((await admin.get('/api/v1/scholarships/facts').expect(200)).body.facts['income.annualIncome']).toMatchObject({ label: 'Household income', type: 'number' });
    const r = await admin
      .post('/api/v1/scholarships/rules/test')
      .send({ root: { type: 'condition', fact: 'income.annualIncome', operator: 'lte', value: 100 }, facts: { 'income.annualIncome': 50 } })
      .expect(200);
    expect(r.body.reason).toMatch(/^Household income is 50/);
  });

  it('rejects labels for unknown facts or roles', async () => {
    const admin = await h.login('admin');
    await admin.put('/api/v1/admin/settings').send({ factText: { 'made.up': { label: 'x', description: '' } } }).expect(400);
    await admin.put('/api/v1/admin/settings').send({ roleLabels: { superuser: 'x' } }).expect(400);
  });
});
