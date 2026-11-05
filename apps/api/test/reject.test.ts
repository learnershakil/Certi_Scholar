import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditEntryModel, NotificationModel } from '../src/models/system.js';
import { fakeOcr, INCOME, MARKSHEET, png, startHarness, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

describe('upload errors say what went wrong', () => {
  it('publishes the upload limits the form checks before sending', async () => {
    const student = await h.login('student');
    expect((await student.get('/api/v1/documents/upload-policy').expect(200)).body).toEqual({ maxBytes: 2 * 1024 * 1024, accept: ['application/pdf', 'image/png', 'image/jpeg'] });
  });

  it('refuses an oversized file with its size and the limit', async () => {
    const student = await h.login('student');
    const res = await student.post('/api/v1/documents').attach('file', Buffer.concat([png('big'), Buffer.alloc(3 * 1024 * 1024)]), 'big.png').expect(413);
    expect(res.body.error).toMatchObject({ code: 'file_too_large' });
    expect(res.body.error.message).toMatch(/This file is 3\.\d MB\. The limit is 2\.0 MB/);
  });

  it('names the file when its format is not accepted', async () => {
    const student = await h.login('student');
    const res = await student.post('/api/v1/documents').attach('file', Buffer.from('just some text'), 'notes.docx').expect(415);
    expect(res.body.error.message).toMatch(/"notes\.docx" is not a PDF, PNG or JPEG file/);
  });
});

describe('a verifier rejects a wrong document', () => {
  it('takes it out of use with a reason the student sees, and the application shows it as missing', async () => {
    h.ocr.results.set('rjm', fakeOcr(MARKSHEET));
    h.ocr.results.set('rji', fakeOcr(INCOME));
    const [student, verifier] = await Promise.all([h.login('student'), h.login('verifier')]);
    const upload = async (m: string) => (await student.post('/api/v1/documents').attach('file', png(m), `${m}.png`).expect(202)).body.id as string;
    const marks = await upload('rjm');
    const income = await upload('rji');
    await h.queue.drain();
    const mcm = (await student.get('/api/v1/scholarships').expect(200)).body.find((s: { code: string }) => s.code === 'MCM-2026');
    const app = (await student.post('/api/v1/applications').send({ scholarshipId: mcm._id, documentIds: [marks, income] }).expect(201)).body;
    await h.queue.drain();

    await student.post(`/api/v1/documents/${income}/reject`).send({ reason: 'Not mine to reject' }).expect(403);
    await verifier.post(`/api/v1/documents/${income}/claim`).expect(200);
    await verifier.post(`/api/v1/documents/${income}/reject`).send({ reason: 'bad' }).expect(400); // a reason the student can act on
    const rejected = (await verifier.post(`/api/v1/documents/${income}/reject`).send({ reason: 'This is not an income certificate.' }).expect(200)).body;
    expect(rejected).toMatchObject({ status: 'rejected', rejection: { reason: 'This is not an income certificate.' } });
    await verifier.post(`/api/v1/documents/${income}/reject`).send({ reason: 'Again, twice over' }).expect(409);

    // The student sees why, and is told to upload the right one.
    const mine = (await student.get('/api/v1/documents').expect(200)).body.find((d: { id: string }) => d.id === income);
    expect(mine.rejection.reason).toBe('This is not an income certificate.');
    expect(await NotificationModel.exists({ type: 'document_rejected', message: /not an income certificate/ })).toBeTruthy();
    expect(await AuditEntryModel.exists({ action: 'document.rejected' })).toBeTruthy();

    // Out of the queue, unusable for new applications, and missing from the existing one.
    const queue = (await verifier.get('/api/v1/documents/review-queue').expect(200)).body;
    expect(queue.find((q: { id: string }) => q.id === income)).toBeUndefined();
    const gstem = (await student.get('/api/v1/scholarships').expect(200)).body.find((s: { code: string }) => s.code === 'GSTEM-2026');
    await student.post('/api/v1/applications').send({ scholarshipId: gstem._id, documentIds: [marks, income] }).expect(400);
    await h.queue.drain();
    const rec = (await student.get(`/api/v1/applications/${app._id}/recommendation`).expect(200)).body;
    expect(rec.outcome).toBe('needs_review');
    expect(rec.summary).toMatch(/Missing required document\(s\): income_certificate/);
  });
});
