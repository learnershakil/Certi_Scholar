import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { UserModel } from '../src/models/user.js';
import { AuditEntryModel, NotificationModel } from '../src/models/system.js';
import { parseCsv } from '../src/lib/csv.js';
import { demoEmail, startHarness, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

describe('creating accounts', () => {
  it('needs only an email and an initial password; the role defaults to student', async () => {
    const admin = await h.login('admin');
    const { body } = await admin.post('/api/v1/admin/users').send({ email: 'Solo.Student@Example.test', password: 'Initial#Pass2026' }).expect(201);
    expect(body).toMatchObject({ email: 'solo.student@example.test', role: 'student' });
    expect((await UserModel.findOne({ email: 'solo.student@example.test' }).lean())!.name).toBeUndefined();
    const dup = await admin.post('/api/v1/admin/users').send({ email: 'solo.student@example.test', password: 'Initial#Pass2026' }).expect(409);
    expect(dup.body.error.message).toMatch(/already exists/);
    await admin.post('/api/v1/admin/users').send({ email: 'x@example.test', password: 'short' }).expect(400);
    await (await h.login('verifier')).post('/api/v1/admin/users').send({ email: 'y@example.test', password: 'Initial#Pass2026' }).expect(403);
  });
});

describe('importing accounts from CSV', () => {
  const csv = [
    'Email,Password,Role',
    'csv.one@example.test,Initial#Pass2026,student',
    '"csv.two@example.test","Pass,with,commas!",verifier',
    'csv.three@example.test,Initial#Pass2026,',
    'csv.one@example.test,Initial#Pass2026,student',
    `${demoEmail('student')},Initial#Pass2026,student`,
    'not-an-email,Initial#Pass2026,student',
    'csv.four@example.test,short,student',
    'csv.five@example.test,Initial#Pass2026,principal',
    '',
  ].join('\r\n');

  it('previews every row without creating anything', async () => {
    const admin = await h.login('admin');
    const { body } = await admin.post('/api/v1/admin/users/import').send({ csv, dryRun: true }).expect(200);
    expect(body.summary).toEqual({ ready: 3, created: 0, skipped: 1, invalid: 4 });
    const byLine = Object.fromEntries(body.rows.map((r: { line: number }) => [r.line, r]));
    expect(byLine[3]).toMatchObject({ email: 'csv.two@example.test', outcome: 'ready', role: 'verifier' });
    expect(byLine[4]).toMatchObject({ outcome: 'ready', role: 'student' }); // empty role → student
    expect(byLine[5]).toMatchObject({ outcome: 'invalid', reason: 'Listed twice in this file' });
    expect(byLine[6]).toMatchObject({ outcome: 'skipped' });
    expect(byLine[7].reason).toMatch(/valid email/);
    expect(byLine[8].reason).toMatch(/at least 10 characters/);
    expect(byLine[9].reason).toBe('Unknown role "principal"');
    expect(JSON.stringify(body)).not.toContain('Initial#Pass2026'); // passwords are never echoed back
    expect(await UserModel.countDocuments({ email: /^csv\./ })).toBe(0);
  });

  it('creates the valid rows, skips existing emails, and the new accounts can sign in', async () => {
    const admin = await h.login('admin');
    const { body } = await admin.post('/api/v1/admin/users/import').send({ csv }).expect(200);
    expect(body.summary).toMatchObject({ created: 3, skipped: 1, invalid: 4 });
    expect((await UserModel.findOne({ email: 'csv.two@example.test' }).lean())!.role).toBe('verifier');
    await request(h.app).post('/api/v1/auth/login').send({ email: 'csv.two@example.test', password: 'Pass,with,commas!' }).expect(200);
    expect(await AuditEntryModel.exists({ action: 'users.imported' })).toBeTruthy();

    const again = (await admin.post('/api/v1/admin/users/import').send({ csv }).expect(200)).body;
    expect(again.summary).toMatchObject({ created: 0, skipped: 4 }); // re-running never overwrites
  });

  it('explains a file without the required columns', async () => {
    const admin = await h.login('admin');
    const res = await admin.post('/api/v1/admin/users/import').send({ csv: 'name,mail\nA,b@example.test' }).expect(400);
    expect(res.body.error.message).toMatch(/email, password/);
  });

  it('reads quoted cells, doubled quotes, a byte-order mark and blank lines', () => {
    expect(parseCsv('﻿a,b\n"x, y","say ""hi"""\n\n"multi\nline",z')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', 'z']]);
  });
});

describe('verification officers correct student details', () => {
  it('changes locked details with a reason, audits it and tells the student', async () => {
    const verifier = await h.login('verifier');
    const list = (await verifier.get('/api/v1/students?q=ananya').expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ email: demoEmail('student'), profile: { fatherName: 'Rajesh Sharma' }, profileComplete: true });

    await verifier.patch(`/api/v1/students/${list[0].id}`).send({ profile: { fatherName: 'Rajesh K Sharma' } }).expect(400); // reason required
    const { body } = await verifier.patch(`/api/v1/students/${list[0].id}`).send({ profile: { fatherName: 'Rajesh K Sharma' }, reason: 'Matches the board certificate' }).expect(200);
    expect(body.profile.fatherName).toBe('Rajesh K Sharma');
    const entry = await AuditEntryModel.findOne({ action: 'applicant.details_corrected' }).lean();
    expect(entry?.details).toMatchObject({ before: { fatherName: 'Rajesh Sharma' }, after: { fatherName: 'Rajesh K Sharma' }, reason: 'Matches the board certificate' });
    expect(await NotificationModel.exists({ type: 'profile_updated', message: /father's name was updated/ })).toBeTruthy();
  });

  it('is limited to verification officers and administrators, and to student accounts', async () => {
    const [student, officer, admin] = await Promise.all([h.login('student'), h.login('officer'), h.login('admin')]);
    await student.get('/api/v1/students').expect(403);
    await officer.get('/api/v1/students').expect(403);
    const verifierId = String((await UserModel.findOne({ email: demoEmail('verifier') }).lean())!._id);
    await admin.patch(`/api/v1/students/${verifierId}`).send({ name: 'Someone', reason: 'Not a student account' }).expect(404);
  });
});

describe('paged lists', () => {
  it('returns one page with the total in a header, and the whole list without ?page', async () => {
    const admin = await h.login('admin');
    const all = (await admin.get('/api/v1/admin/users').expect(200)).body;
    expect(all.length).toBeGreaterThan(3);
    const first = await admin.get('/api/v1/admin/users?page=1&pageSize=2').expect(200);
    expect(first.body).toHaveLength(2);
    expect(first.headers).toMatchObject({ 'x-total-count': String(all.length), 'x-page': '1', 'x-page-size': '2' });
    const second = (await admin.get('/api/v1/admin/users?page=2&pageSize=2').expect(200)).body;
    expect(second.map((u: { email: string }) => u.email)).toEqual(all.slice(2, 4).map((u: { email: string }) => u.email));
    expect((await admin.get('/api/v1/admin/users?page=1&pageSize=100000').expect(200)).headers['x-page-size']).toBe('200'); // capped at LIST_PAGE_SIZE
  });

  it('pages filtered lists by the filtered total', async () => {
    const verifier = await h.login('verifier');
    const res = await verifier.get('/api/v1/students?q=ananya&page=1&pageSize=10').expect(200);
    expect(res.headers['x-total-count']).toBe('1');
  });
});
