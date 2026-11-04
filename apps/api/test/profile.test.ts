import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AuditEntryModel } from '../src/models/system.js';
import { RecommendationModel } from '../src/models/scholarship.js';
import { DEMO_PASSWORD, demoEmail, fakeOcr, INCOME, MARKSHEET, png, startHarness, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

describe('own profile', () => {
  it('shows the signed-in person their details', async () => {
    const student = await h.login('student');
    const { body } = await student.get('/api/v1/auth/me/profile').expect(200);
    expect(body).toMatchObject({ email: demoEmail('student'), role: 'student', profile: { category: 'OBC', gender: 'female' } });
    expect(body.passwordHash).toBeUndefined();
  });

  it('updates name and phone, audits the change, and shows the new name at once', async () => {
    const verifier = await h.login('verifier');
    const { body } = await verifier.patch('/api/v1/auth/me/profile').send({ name: 'Rahul K. Mehta', profile: { phone: '+91 98765 43210' } }).expect(200);
    expect(body).toMatchObject({ name: 'Rahul K. Mehta', profile: { phone: '+91 98765 43210' } });
    expect((await verifier.get('/api/v1/auth/me').expect(200)).body.name).toBe('Rahul K. Mehta');
    const entry = await AuditEntryModel.findOne({ action: 'profile.updated', actorRole: 'verifier' }).lean();
    expect(entry?.details).toMatchObject({ before: { name: 'Rahul Mehta' } });
  });

  it('cannot change email, role or anyone else', async () => {
    const student = await h.login('student');
    await student.patch('/api/v1/auth/me/profile').send({ email: 'other@example.test', role: 'admin' }).expect(200);
    const { body } = await student.get('/api/v1/auth/me/profile').expect(200);
    expect(body).toMatchObject({ email: demoEmail('student'), role: 'student' });
  });

  it('keeps applicant details to students and to the rule engine’s allowed values', async () => {
    const officer = await h.login('officer');
    await officer.patch('/api/v1/auth/me/profile').send({ profile: { category: 'SC' } }).expect(403);
    const student = await h.login('student');
    await student.patch('/api/v1/auth/me/profile').send({ profile: { category: 'XYZ' } }).expect(400);
    await student.patch('/api/v1/auth/me/profile').send({ profile: { phone: 'call me' } }).expect(400);
    await student.patch('/api/v1/auth/me/profile').send({ name: 'A' }).expect(400);
  });

  it('re-checks open applications when applicant details change', async () => {
    h.ocr.results.set('pm', fakeOcr(MARKSHEET));
    h.ocr.results.set('pi', fakeOcr(INCOME));
    const student = await h.login('student');
    const ids = [];
    for (const m of ['pm', 'pi']) ids.push((await student.post('/api/v1/documents').attach('file', png(m), `${m}.png`).expect(202)).body.id);
    await h.queue.drain();
    const gstem = (await student.get('/api/v1/scholarships')).body.find((s: { code: string }) => s.code === 'GSTEM-2026');
    const app = (await student.post('/api/v1/applications').send({ scholarshipId: gstem._id, documentIds: ids }).expect(201)).body;
    await h.queue.drain();
    const before = await RecommendationModel.countDocuments({ application: app._id });

    await student.patch('/api/v1/auth/me/profile').send({ profile: { category: 'SC' } }).expect(200);
    await h.queue.drain();
    expect(await RecommendationModel.countDocuments({ application: app._id })).toBe(before + 1);
    const latest = (await student.get(`/api/v1/applications/${app._id}/recommendation`).expect(200)).body;
    expect(latest.facts['applicant.category'].value).toBe('SC');
  });
});

describe('password change', () => {
  it('needs the current password and a different new one', async () => {
    const admin = await h.login('admin');
    await admin.post('/api/v1/auth/me/password').send({ currentPassword: 'wrong-password', newPassword: 'brand-new-password' }).expect(400);
    await admin.post('/api/v1/auth/me/password').send({ currentPassword: DEMO_PASSWORD, newPassword: DEMO_PASSWORD }).expect(400);
    await admin.post('/api/v1/auth/me/password').send({ currentPassword: DEMO_PASSWORD, newPassword: 'short' }).expect(400);
  });

  it('changes it: the old password stops working and the change is audited', async () => {
    const officer = await h.login('officer');
    await officer.post('/api/v1/auth/me/password').send({ currentPassword: DEMO_PASSWORD, newPassword: 'officer-new-pass-2026' }).expect(204);
    await request(h.app).post('/api/v1/auth/login').send({ email: demoEmail('officer'), password: DEMO_PASSWORD }).expect(401);
    await request(h.app).post('/api/v1/auth/login').send({ email: demoEmail('officer'), password: 'officer-new-pass-2026' }).expect(200);
    expect(await AuditEntryModel.exists({ action: 'password.changed' })).toBeTruthy();
  });
});
