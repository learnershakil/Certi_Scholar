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

  it('fixes a student’s details once set: changing them is refused, repeating them is fine, phone stays editable', async () => {
    const student = await h.login('student');
    const res = await student.patch('/api/v1/auth/me/profile').send({ profile: { gender: 'male' } }).expect(409);
    expect(res.body.error.message).toMatch(/gender is already set\. Only a verification officer or administrator can change it/);
    await student.patch('/api/v1/auth/me/profile').send({ name: 'Ananya S' }).expect(409);
    await student.patch('/api/v1/auth/me/profile').send({ profile: { fatherName: 'Someone Else' } }).expect(409);
    await student.patch('/api/v1/auth/me/profile').send({ profile: { state: '' } }).expect(400);
    await student.patch('/api/v1/auth/me/profile').send({ profile: { gender: 'female', state: 'Karnataka', phone: '+91 90000 00000' } }).expect(200);
    expect((await student.get('/api/v1/auth/me/profile').expect(200)).body.profile).toMatchObject({ gender: 'female', state: 'Karnataka', fatherName: 'Rajesh Sharma', phone: '+91 90000 00000' });
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
  it('a new student must give name, parents’ names, gender and state before using the app, once', async () => {
    const admin = await h.login('admin');
    await admin.post('/api/v1/admin/users').send({ email: 'new.student@example.test', password: 'Initial#Pass2026' }).expect(201);
    const agent = request.agent(h.app);
    const first = (await agent.post('/api/v1/auth/login').send({ email: 'new.student@example.test', password: 'Initial#Pass2026' }).expect(200)).body;
    expect(first).toMatchObject({ firstLogin: true, profileComplete: false, name: null, role: 'student' });

    // Applying needs the details the rules and the document checks use.
    const mcm = (await agent.get('/api/v1/scholarships').expect(200)).body.find((s: { code: string }) => s.code === 'MCM-2026');
    const refused = await agent.post('/api/v1/applications').send({ scholarshipId: mcm._id, documentIds: ['000000000000000000000000'] }).expect(400);
    expect(refused.body.error.message).toMatch(/Complete your profile/);

    const partial = (await agent.patch('/api/v1/auth/me/profile').send({ name: 'Kavya Nair', profile: { gender: 'female', state: 'Kerala' } }).expect(200)).body;
    expect(partial.profileComplete).toBe(false); // parents' names still missing
    const done = (await agent.patch('/api/v1/auth/me/profile').send({ profile: { fatherName: 'Suresh Nair', motherName: 'Lakshmi Nair' } }).expect(200)).body;
    expect(done).toMatchObject({ profileComplete: true, name: 'Kavya Nair', profile: { fatherName: 'Suresh Nair', motherName: 'Lakshmi Nair' } });
    await agent.patch('/api/v1/auth/me/profile').send({ profile: { motherName: 'Someone Else' } }).expect(409);

    const again = (await request.agent(h.app).post('/api/v1/auth/login').send({ email: 'new.student@example.test', password: 'Initial#Pass2026' }).expect(200)).body;
    expect(again).toMatchObject({ firstLogin: false, profileComplete: true });
  });

  it('a new staff member only adds their name, and can change it later', async () => {
    const admin = await h.login('admin');
    await admin.post('/api/v1/admin/users').send({ email: 'new.verifier@example.test', role: 'verifier', password: 'Initial#Pass2026' }).expect(201);
    const agent = request.agent(h.app);
    expect((await agent.post('/api/v1/auth/login').send({ email: 'new.verifier@example.test', password: 'Initial#Pass2026' }).expect(200)).body).toMatchObject({ firstLogin: true, profileComplete: false });
    await agent.patch('/api/v1/auth/me/profile').send({ profile: { gender: 'male' } }).expect(403);
    expect((await agent.patch('/api/v1/auth/me/profile').send({ name: 'Imran Khan' }).expect(200)).body.profileComplete).toBe(true);
    expect((await agent.patch('/api/v1/auth/me/profile').send({ name: 'Imran A. Khan' }).expect(200)).body.name).toBe('Imran A. Khan');
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
