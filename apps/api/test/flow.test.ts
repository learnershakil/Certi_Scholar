import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { CorrectionModel, DocumentModel, ExtractedFieldModel } from '../src/models/document.js';
import { AuditEntryModel, DocumentAccessLogModel, NotificationModel, SettingsModel } from '../src/models/system.js';
import { OcrServiceError } from '../src/ocr/client.js';
import { runRetention } from '../src/pipeline/documentPipeline.js';
import { DEMO_PASSWORD, demoEmail, fakeOcr, IDENTITY, INCOME, MARKSHEET, png, startHarness, type Harness } from './helpers.js';

let h: Harness;
let student: Awaited<ReturnType<Harness['login']>>;
let verifier: Awaited<ReturnType<Harness['login']>>;
let officer: Awaited<ReturnType<Harness['login']>>;
let admin: Awaited<ReturnType<Harness['login']>>;

const ids: Record<string, string> = {};

async function upload(agent: typeof student, marker: string, name = `${marker}.png`) {
  const res = await agent.post('/api/v1/documents').attach('file', png(marker), name).expect(202);
  await h.queue.drain();
  return res.body.id as string;
}

beforeAll(async () => {
  h = await startHarness();
  // The printed percentage is read with low confidence, so it must go to human review.
  h.ocr.results.set('marks', fakeOcr(MARKSHEET, (w) => (w === '88.20' ? 0.62 : 0.97)));
  h.ocr.results.set('income', fakeOcr(INCOME));
  h.ocr.results.set('identity', fakeOcr(IDENTITY));
  [student, verifier, officer, admin] = await Promise.all([h.login('student'), h.login('verifier'), h.login('officer'), h.login('admin')]);
});
afterAll(() => h.stop());

describe('authentication', () => {
  it('accepts the account role picked at login and refuses any other, with the same message', async () => {
    const login = (role?: string) => request(h.app).post('/api/v1/auth/login').send({ email: demoEmail('verifier'), password: DEMO_PASSWORD, role });
    expect((await login('verifier').expect(200)).body.role).toBe('verifier');
    const wrongRole = (await login('admin').expect(401)).body.error.message;
    const wrongPassword = (await request(h.app).post('/api/v1/auth/login').send({ email: demoEmail('verifier'), password: 'x', role: 'verifier' }).expect(401)).body.error.message;
    expect(wrongRole).toBe(wrongPassword);
    await login('superuser').expect(400);
    await login().expect(200); // scripts and API clients may omit the role
  });

  it('rejects bad credentials and unauthenticated calls', async () => {
    await request(h.app).post('/api/v1/auth/login').send({ email: demoEmail('student'), password: 'nope' }).expect(401);
    await request(h.app).get('/api/v1/documents').expect(401);
    expect((await student.get('/api/v1/auth/me').expect(200)).body.role).toBe('student');
  });
});

describe('M1 secure intake', () => {
  it('rejects unsupported content regardless of the declared name', async () => {
    const res = await student.post('/api/v1/documents').attach('file', Buffer.from('MZ\x90\x00 not a document at all'), 'marksheet.pdf').expect(415);
    expect(res.body.error.code).toBe('unsupported_type');
  });

  it('rejects malware before storing anything', async () => {
    const before = await DocumentModel.countDocuments();
    const eicar = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`)]);
    await student.post('/api/v1/documents').attach('file', eicar, 'x.pdf').expect(422);
    expect(await DocumentModel.countDocuments()).toBe(before);
    expect(await AuditEntryModel.exists({ action: 'document.rejected_malware' })).toBeTruthy();
  });

  it('rejects PDFs with active content and oversize files', async () => {
    await student.post('/api/v1/documents').attach('file', Buffer.from('%PDF-1.7 /OpenAction /JavaScript'), 'a.pdf').expect(422);
    await student.post('/api/v1/documents').attach('file', Buffer.concat([png('big'), Buffer.alloc(3 * 1024 * 1024)]), 'big.png').expect(413);
  });

  it('only students upload', async () => {
    await verifier.post('/api/v1/documents').attach('file', png('marks'), 'm.png').expect(403);
  });
});

describe('pipeline, review and correction (M2–M6)', () => {
  it('processes a marksheet asynchronously and routes the low-confidence field to review', async () => {
    ids.marks = await upload(student, 'marks', 'marksheet.png');
    const status = (await student.get(`/api/v1/documents/${ids.marks}/status`).expect(200)).body;
    expect(status.status).toBe('needs_review');
    expect(status.stages.map((s: { status: string }) => s.status)).toEqual(['done', 'done', 'done', 'done', 'done']);

    const fields = (await student.get(`/api/v1/documents/${ids.marks}/fields`).expect(200)).body;
    const pct = fields.find((f: { key: string }) => f.key === 'percentage');
    expect(pct).toMatchObject({ value: '88.20', status: 'needs_review' });
    expect(pct.bbox).toHaveLength(4);
    expect(fields.filter((f: { status: string }) => f.status === 'needs_review')).toHaveLength(1);

    const doc = (await student.get(`/api/v1/documents/${ids.marks}`).expect(200)).body;
    expect(doc.documentType).toBe('marksheet');
    expect(doc.authenticity.established).toBe(false);
    expect(doc.consistencyChecks.every((c: { status: string }) => c.status === 'pass')).toBe(true);
    expect(await NotificationModel.exists({ type: 'review_required' })).toBeTruthy();
  });

  it('keeps other students out', async () => {
    const other = await h.login('student2');
    await other.get(`/api/v1/documents/${ids.marks}`).expect(404);
    await other.post(`/api/v1/documents/${ids.marks}/access-url`).send({}).expect(404);
  });

  it('requires a verifier to claim a case before opening it', async () => {
    await verifier.get(`/api/v1/documents/${ids.marks}/fields`).expect(403);
    const queue = (await verifier.get('/api/v1/documents/review-queue').expect(200)).body;
    const item = queue.find((q: { id: string }) => q.id === ids.marks);
    expect(item).toMatchObject({ pendingFields: 1, assignedTo: null });
    expect(item.originalName).toBeUndefined(); // metadata only
    await verifier.post(`/api/v1/documents/${ids.marks}/claim`).expect(200);
    await verifier.get(`/api/v1/documents/${ids.marks}/fields`).expect(200);
  });

  it('students cannot correct fields', async () => {
    await student.patch(`/api/v1/documents/${ids.marks}/fields/percentage`).send({ value: '99', reason: 'mine' }).expect(403);
  });

  it('blocks review completion while fields are pending', async () => {
    await verifier.post(`/api/v1/documents/${ids.marks}/review/complete`).expect(409);
  });

  it('records an audited correction and re-runs consistency', async () => {
    await verifier.patch(`/api/v1/documents/${ids.marks}/fields/percentage`).send({ value: '' }).expect(400);
    const res = await verifier
      .patch(`/api/v1/documents/${ids.marks}/fields/percentage`)
      .send({ value: '91.00', reason: 'Testing that a wrong value is caught' })
      .expect(200);
    expect(res.body.status).toBe('corrected');
    const correction = await CorrectionModel.findOne({ document: ids.marks }).lean();
    expect(correction).toMatchObject({ fieldKey: 'percentage', previousValue: '88.20', newValue: '91.00', previousConfidence: 0.62 });
    expect(await AuditEntryModel.exists({ action: 'field.corrected', entityId: ids.marks })).toBeTruthy();

    const doc = (await verifier.get(`/api/v1/documents/${ids.marks}`).expect(200)).body;
    const pct = doc.consistencyChecks.find((c: { code: string }) => c.code === 'percentage_matches_marks');
    expect(pct).toMatchObject({ status: 'fail', expected: 88.2, actual: 91 });
  });

  it('corrects back, completes review and reprocesses idempotently with corrections preserved', async () => {
    await verifier.patch(`/api/v1/documents/${ids.marks}/fields/percentage`).send({ value: '88.20', reason: 'Matches the printed document' }).expect(200);
    await verifier.post(`/api/v1/documents/${ids.marks}/fields/roll_number/confirm`).expect(200);
    await verifier.post(`/api/v1/documents/${ids.marks}/review/complete`).expect(200);

    const before = await ExtractedFieldModel.countDocuments({ document: ids.marks });
    await verifier.post(`/api/v1/documents/${ids.marks}/reprocess`).send({ from: 'analyse' }).expect(202);
    await h.queue.drain();
    await verifier.post(`/api/v1/documents/${ids.marks}/reprocess`).send({ from: 'analyse' }).expect(202);
    await h.queue.drain();
    expect(await ExtractedFieldModel.countDocuments({ document: ids.marks })).toBe(before);
    const pct = await ExtractedFieldModel.findOne({ document: ids.marks, key: 'percentage' }).lean();
    expect(pct).toMatchObject({ value: '88.20', status: 'corrected' });
    expect((await DocumentModel.findById(ids.marks).lean())?.status).toBe('processed');
  });
});

describe('document type chosen by the student', () => {
  it('settles an inconclusive classification, but only for a known type', async () => {
    h.ocr.results.set('weak', fakeOcr(['Marks list', 'Percentage: 75.00']));
    await student.post('/api/v1/documents').field('declaredType', 'passport').attach('file', png('weak'), 'w.png').expect(400);
    const res = await student.post('/api/v1/documents').field('declaredType', 'marksheet').attach('file', png('weak'), 'w.png').expect(202);
    await h.queue.drain();
    const doc = (await student.get(`/api/v1/documents/${res.body.id}`).expect(200)).body;
    expect(doc).toMatchObject({ documentType: 'marksheet', declaredType: 'marksheet', classification: { source: 'declared' } });
    // Fields the text does not contain still go to review: the declaration does not fill anything in.
    const fields = (await student.get(`/api/v1/documents/${res.body.id}/fields`).expect(200)).body;
    expect(fields.find((f: { key: string }) => f.key === 'roll_number')).toMatchObject({ value: null, status: 'needs_review' });
  });

  it('never overrides a confident classification', async () => {
    const res = await student.post('/api/v1/documents').field('declaredType', 'identity').attach('file', png('income'), 'i.png').expect(202);
    await h.queue.drain();
    expect((await student.get(`/api/v1/documents/${res.body.id}`).expect(200)).body).toMatchObject({ documentType: 'income_certificate', classification: { source: 'keywords' } });
  });
});

describe('OCR service failure handling', () => {
  it('leaves the document failed but retryable, then succeeds on reprocess', async () => {
    h.ocr.results.set('flaky', new OcrServiceError('OCR service 503', true));
    const id = await upload(student, 'flaky');
    const doc = await DocumentModel.findById(id).lean();
    expect(doc?.status).toBe('failed');
    expect(doc?.stages.find((s) => s.name === 'ocr')).toMatchObject({ status: 'failed', attempts: 3 });
    expect(doc?.storageKey).toBeTruthy(); // file retained for retry

    h.ocr.results.set('flaky', fakeOcr(INCOME));
    const queue = (await verifier.get('/api/v1/documents/review-queue').expect(200)).body;
    expect(queue.some((q: { id: string }) => q.id === id)).toBe(true);
    await verifier.post(`/api/v1/documents/${id}/claim`).expect(200);
    await verifier.post(`/api/v1/documents/${id}/reprocess`).send({ from: 'ocr' }).expect(202);
    await h.queue.drain();
    expect((await DocumentModel.findById(id).lean())?.status).toBe('processed');
  });

  it('does not retry a non-retryable failure', async () => {
    h.ocr.results.set('corrupt', new OcrServiceError('unreadable image', false));
    const calls = h.ocr.calls;
    const id = await upload(student, 'corrupt');
    expect(h.ocr.calls - calls).toBe(1);
    expect((await DocumentModel.findById(id).lean())?.status).toBe('failed');
  });

  it('flags an unclassifiable document for review', async () => {
    h.ocr.results.set('letter', fakeOcr(['Dear Sir', 'Please find attached']));
    const id = await upload(student, 'letter');
    const doc = await DocumentModel.findById(id).lean();
    expect(doc).toMatchObject({ status: 'needs_review', documentType: null });
    expect(doc?.stages.find((s) => s.name === 'extract')?.status).toBe('skipped');
  });
});

describe('document access (pre-signed, logged)', () => {
  it('serves content only through a short-lived token bound to the user, and logs every view', async () => {
    const { url, expiresAt } = (await student.post(`/api/v1/documents/${ids.marks}/access-url`).send({ variant: 'preview' }).expect(200)).body;
    expect(new Date(expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(120_000);
    const file = await student.get(url).expect(200);
    expect(file.headers['cache-control']).toBe('private, no-store');
    expect(file.body.toString()).toBe('preview-image');
    await verifier.get(url).expect(403); // token belongs to the student
    await student.get('/api/v1/files/forged.token').expect(403);
    expect(await DocumentAccessLogModel.countDocuments({ document: ids.marks })).toBe(1);
    const log = (await admin.get(`/api/v1/documents/${ids.marks}/access-log`).expect(200)).body;
    expect(log[0]).toMatchObject({ variant: 'preview', actorRole: 'student' });
  });
});

describe('verification adapter (M7)', () => {
  it('labels a simulated result and never treats it as authenticity', async () => {
    await verifier.post(`/api/v1/documents/${ids.marks}/verify`).expect(202);
    await h.queue.drain();
    const doc = (await verifier.get(`/api/v1/documents/${ids.marks}`).expect(200)).body;
    expect(doc.verification).toMatchObject({ status: 'simulated_match', simulated: true });
    expect(doc.verification.providerLabel).toMatch(/^SIMULATED/);
    expect(doc.authenticity.established).toBe(false);
    expect(doc.verificationResults[0]).toMatchObject({ authoritative: false, simulated: true });
  });

  it('falls back to manual verification when no provider is configured', async () => {
    await SettingsModel.updateOne({ _id: 'global' }, { verificationProvider: 'manual_only' });
    await verifier.post(`/api/v1/documents/${ids.marks}/verify`).expect(409);
    await verifier.post(`/api/v1/documents/${ids.marks}/verify/manual`).send({ outcome: 'match', note: 'short' }).expect(400);
    await verifier
      .post(`/api/v1/documents/${ids.marks}/verify/manual`)
      .send({ outcome: 'match', note: 'Confirmed by phone with the board results office, ref BRD-7781' })
      .expect(201);
    const doc = (await verifier.get(`/api/v1/documents/${ids.marks}`).expect(200)).body;
    expect(doc.verification.status).toBe('manual_match');
    expect(doc.authenticity.established).toBe(true);
  });
});

describe('applications and explainable recommendation (M8–M9)', () => {
  it('recommends with a condition-by-condition breakdown', async () => {
    ids.income = await upload(student, 'income', 'income.png');
    // Processed but unverified documents appear in the verifier queue as verification work.
    const queue = (await verifier.get('/api/v1/documents/review-queue').expect(200)).body;
    expect(queue.find((q: { id: string }) => q.id === ids.income)).toMatchObject({ reason: 'verification' });
    await verifier.post(`/api/v1/documents/${ids.income}/claim`).expect(200);
    await verifier.post(`/api/v1/documents/${ids.income}/verify/manual`).send({ outcome: 'match', note: 'Confirmed via Tahsildar office e-register' }).expect(201);

    const scholarships = (await student.get('/api/v1/scholarships').expect(200)).body;
    const mcm = scholarships.find((s: { code: string }) => s.code === 'MCM-2026');
    const app = (await student.post('/api/v1/applications').send({ scholarshipId: mcm._id, documentIds: [ids.marks, ids.income] }).expect(201)).body;
    ids.app = app._id;
    await h.queue.drain();

    const rec = (await student.get(`/api/v1/applications/${ids.app}/recommendation`).expect(200)).body;
    expect(rec.outcome).toBe('recommended');
    expect(rec.ruleVersion).toBe(1);
    expect(rec.evaluation.children).toHaveLength(5);
    for (const c of rec.evaluation.children) expect(c).toMatchObject({ outcome: 'pass', reason: expect.any(String) });
    expect(rec.facts['marksheet.percentage']).toMatchObject({ value: 88.2, source: 'Recomputed from subject marks' });
    expect(rec.facts['income.annualIncome'].value).toBe(240000);
    expect(rec.authenticity.every((a: { established: boolean }) => a.established)).toBe(true);
  });

  it("rejects applications using someone else's documents", async () => {
    const other = await h.login('student2');
    const mcm = (await other.get('/api/v1/scholarships')).body[0];
    await other.post('/api/v1/applications').send({ scholarshipId: mcm._id, documentIds: [ids.marks] }).expect(400);
  });

  it('refuses an application without every required document, and explains one that later loses a document', async () => {
    const gstem = (await student.get('/api/v1/scholarships')).body.find((s: { code: string }) => s.code === 'GSTEM-2026');
    const refused = await student.post('/api/v1/applications').send({ scholarshipId: gstem._id, documentIds: [ids.marks] }).expect(400);
    expect(refused.body.error.details.missing).toEqual(['income_certificate', 'identity']);

    const identity = await upload(student, 'identity', 'identity.png');
    const app = (await student.post('/api/v1/applications').send({ scholarshipId: gstem._id, documentIds: [ids.marks, ids.income, identity] }).expect(201)).body;
    await h.queue.drain();

    // A document removed after submission (e.g. by the retention policy) counts as missing again.
    await DocumentModel.updateOne({ _id: identity }, { status: 'purged' });
    await officer.post(`/api/v1/applications/${app._id}/recommendation`).expect(201);
    const rec = (await student.get(`/api/v1/applications/${app._id}/recommendation`).expect(200)).body;
    expect(rec.outcome).toBe('needs_review');
    expect(rec.summary).toMatch(/Missing required document\(s\): identity/);
    expect(await NotificationModel.exists({ type: 'additional_document_needed' })).toBeTruthy();
  });

  it('scopes applications to assigned officers and records the award decision', async () => {
    const list = (await officer.get('/api/v1/applications').expect(200)).body;
    expect(list.length).toBe(2);
    await student.post(`/api/v1/applications/${ids.app}/decision`).send({ outcome: 'awarded', note: 'x' }).expect(403);
    await officer.post(`/api/v1/applications/${ids.app}/decision`).send({ outcome: 'awarded', note: 'Approved by committee 2026-11' }).expect(200);
    await officer.post(`/api/v1/applications/${ids.app}/decision`).send({ outcome: 'rejected', note: 'again' }).expect(409);
    expect(await NotificationModel.exists({ type: 'award_decision' })).toBeTruthy();

    const csv = (await officer.get('/api/v1/reports/awards.csv').expect(200)).text;
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('Ananya Sharma');
  });

  it('provides a complete timeline for the application', async () => {
    const tl = (await officer.get(`/api/v1/applications/${ids.app}/timeline`).expect(200)).body;
    const stages = new Set(tl.map((t: { stage: string }) => t.stage));
    for (const s of ['scan', 'ocr', 'classify', 'extract', 'consistency', 'review', 'verify', 'application', 'recommendation', 'decision']) {
      expect(stages).toContain(s);
    }
  });

  it('reports metrics', async () => {
    const r = (await officer.get('/api/v1/reports/summary').expect(200)).body;
    expect(r.applicationsByStatus.awarded).toBe(1);
    expect(r.extraction.find((e: { field: string }) => e.field === 'percentage')).toMatchObject({ corrected: 2, lowConfidence: 1 });
    expect(r.verification.simulatedResults).toBe(1);
    expect(r.stageTimings.map((s: { stage: string }) => s.stage)).toContain('ocr');
    expect(r.officerThroughput.length).toBeGreaterThan(0);
    await student.get('/api/v1/reports/summary').expect(403);
  });
});

describe('retention', () => {
  it('purges expired files and extracted data but keeps the audit trail', async () => {
    h.ocr.results.set('old', fakeOcr(IDENTITY));
    const id = await upload(student, 'old');
    await DocumentModel.updateOne({ _id: id }, { retainUntil: new Date(Date.now() - 1000) });
    expect(await runRetention()).toBe(1);
    const doc = await DocumentModel.findById(id).lean();
    expect(doc).toMatchObject({ status: 'purged' });
    expect(doc?.storageKey).toBeUndefined();
    expect(await ExtractedFieldModel.countDocuments({ document: id })).toBe(0);
    expect(await AuditEntryModel.exists({ action: 'document.purged', entityId: id })).toBeTruthy();
    await student.post(`/api/v1/documents/${id}/access-url`).send({}).expect(409);
  });
});
