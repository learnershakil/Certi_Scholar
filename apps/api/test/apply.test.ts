import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApplicationModel } from '../src/models/scholarship.js';
import { fakeOcr, INCOME, MARKSHEET, png, startHarness, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

describe('applying requires every document the scholarship asks for', () => {
  it('refuses an application missing a required document, naming it, and accepts it once attached', async () => {
    h.ocr.results.set('apm', fakeOcr(MARKSHEET));
    h.ocr.results.set('api', fakeOcr(INCOME));
    const student = await h.login('student');
    const upload = async (m: string) => (await student.post('/api/v1/documents').attach('file', png(m), `${m}.png`).expect(202)).body.id as string;
    const marksheet = await upload('apm');
    await h.queue.drain();
    const mcm = (await student.get('/api/v1/scholarships').expect(200)).body.find((s: { code: string }) => s.code === 'MCM-2026');

    const refused = await student.post('/api/v1/applications').send({ scholarshipId: mcm._id, documentIds: [marksheet] }).expect(400);
    expect(refused.body.error.message).toMatch(/Income Certificate missing/);
    expect(refused.body.error.details).toEqual({ missing: ['income_certificate'] });
    expect(await ApplicationModel.countDocuments({ scholarship: mcm._id })).toBe(0);

    const income = await upload('api');
    await h.queue.drain();
    await student.post('/api/v1/applications').send({ scholarshipId: mcm._id, documentIds: [marksheet, income] }).expect(201);
  });

  it('counts a document by its identified type, not by being attached at all', async () => {
    h.ocr.results.set('apm2', fakeOcr(MARKSHEET));
    const student = await h.login('student2');
    const a = (await student.post('/api/v1/documents').attach('file', png('apm2'), 'income-certificate.png').expect(202)).body.id;
    await h.queue.drain();
    const mcm = (await student.get('/api/v1/scholarships').expect(200)).body.find((s: { code: string }) => s.code === 'MCM-2026');
    // A marksheet named like an income certificate still leaves the income certificate missing.
    const { body } = await student.post('/api/v1/applications').send({ scholarshipId: mcm._id, documentIds: [a] }).expect(400);
    expect(body.error.details.missing).toEqual(['income_certificate']);
  });
});
