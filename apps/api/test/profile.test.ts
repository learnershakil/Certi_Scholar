import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AuditEntryModel } from '../src/models/system.js';
import { ScholarshipModel, ScholarshipRuleModel } from '../src/models/scholarship.js';
import { UserModel } from '../src/models/user.js';
import { retireRemovedFacts } from '../src/seedData.js';
import { DEMO_PASSWORD, demoEmail, startHarness, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

describe('own profile', () => {
  it('shows the signed-in person their details', async () => {
    const student = await h.login('student');
    const { body } = await student.get('/api/v1/auth/me/profile').expect(200);
    expect(body).toMatchObject({ email: demoEmail('student'), role: 'student', profile: { gender: 'female', state: 'Karnataka' }, profileComplete: true });
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
    await officer.patch('/api/v1/auth/me/profile').send({ profile: { gender: 'female' } }).expect(403);
    const student = await h.login('student');
    await student.patch('/api/v1/auth/me/profile').send({ profile: { gender: 'XYZ' } }).expect(400);
    await student.patch('/api/v1/auth/me/profile').send({ profile: { phone: 'call me' } }).expect(400);
    await student.patch('/api/v1/auth/me/profile').send({ name: 'A' }).expect(400);
  });

  it('fixes gender and state once set: changing them is refused, repeating them is fine', async () => {
    const student = await h.login('student');
    const res = await student.patch('/api/v1/auth/me/profile').send({ profile: { gender: 'male' } }).expect(409);
    expect(res.body.error.message).toMatch(/already set and cannot be changed/);
    await student.patch('/api/v1/auth/me/profile').send({ profile: { state: 'Kerala' } }).expect(409);
    await student.patch('/api/v1/auth/me/profile').send({ profile: { state: '' } }).expect(409);
    await student.patch('/api/v1/auth/me/profile').send({ profile: { gender: 'female', state: 'Karnataka', phone: '+91 90000 00000' } }).expect(200);
    expect((await student.get('/api/v1/auth/me/profile').expect(200)).body.profile).toMatchObject({ gender: 'female', state: 'Karnataka' });
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

describe('first sign-in and completing the profile', () => {
  it('flags only the first sign-in, and keeps a new student incomplete until gender and state are set', async () => {
    const admin = await h.login('admin');
    await admin.post('/api/v1/admin/users').send({ email: 'new.student@example.test', name: 'New Student', role: 'student', password: 'Initial#Pass2026' }).expect(201);
    const agent = request.agent(h.app);
    const first = (await agent.post('/api/v1/auth/login').send({ email: 'new.student@example.test', password: 'Initial#Pass2026' }).expect(200)).body;
    expect(first).toMatchObject({ firstLogin: true, profileComplete: false });
    expect((await agent.get('/api/v1/auth/me').expect(200)).body.profileComplete).toBe(false);

    // Applying needs the details the rules use.
    const mcm = (await agent.get('/api/v1/scholarships').expect(200)).body.find((s: { code: string }) => s.code === 'MCM-2026');
    const refused = await agent.post('/api/v1/applications').send({ scholarshipId: mcm._id, documentIds: ['000000000000000000000000'] }).expect(400);
    expect(refused.body.error.message).toMatch(/Complete your profile/);

    await agent.patch('/api/v1/auth/me/profile').send({ profile: { state: '' } }).expect(400);
    const done = (await agent.patch('/api/v1/auth/me/profile').send({ profile: { gender: 'other', state: 'Goa' } }).expect(200)).body;
    expect(done.profileComplete).toBe(true);
    await agent.patch('/api/v1/auth/me/profile').send({ profile: { gender: 'female' } }).expect(409);

    const again = (await request.agent(h.app).post('/api/v1/auth/login').send({ email: 'new.student@example.test', password: 'Initial#Pass2026' }).expect(200)).body;
    expect(again).toMatchObject({ firstLogin: false, profileComplete: true });
  });

  it('never asks staff to complete applicant details', async () => {
    const verifier = await h.login('verifier');
    expect((await verifier.get('/api/v1/auth/me').expect(200)).body.profileComplete).toBe(true);
  });
});

describe('retiring the applicant category', () => {
  it('publishes a new version of live rules without it and clears stored values, once', async () => {
    const sch = await ScholarshipModel.findOne({ code: 'GSTEM-2026' }).lean();
    const latest = await ScholarshipRuleModel.findOne({ scholarship: sch!._id }).sort({ version: -1 }).lean();
    await ScholarshipRuleModel.updateMany({ scholarship: sch!._id }, { active: false });
    await ScholarshipRuleModel.create({
      scholarship: sch!._id, version: latest!.version + 1, changeNote: 'old rule',
      root: { type: 'group', op: 'AND', children: [
        { type: 'condition', fact: 'marksheet.percentage', operator: 'gte', value: 75 },
        { type: 'group', op: 'OR', children: [
          { type: 'condition', fact: 'income.annualIncome', operator: 'lte', value: 800000 },
          { type: 'condition', fact: 'applicant.category', operator: 'in', value: ['SC', 'ST'] },
        ] },
      ] },
    });
    await UserModel.collection.updateOne({ email: demoEmail('student2') }, { $set: { 'profile.category': 'GEN' } });

    await retireRemovedFacts();
    const live = await ScholarshipRuleModel.findOne({ scholarship: sch!._id, active: true }).lean();
    expect(live!.version).toBe(latest!.version + 2);
    expect(JSON.stringify(live!.root)).not.toContain('applicant.category');
    expect(JSON.stringify(live!.root)).toContain('income.annualIncome');
    expect((await UserModel.collection.findOne({ email: demoEmail('student2') }))!.profile.category).toBeUndefined();

    await retireRemovedFacts(); // nothing left to do
    expect(await ScholarshipRuleModel.countDocuments({ scholarship: sch!._id })).toBe(latest!.version + 2);
  });
});
