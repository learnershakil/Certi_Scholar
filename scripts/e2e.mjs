// End-to-end run against a live stack (docker compose up). Usage: node scripts/e2e.mjs
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, failed, session, settled, waitFor } from './lib.mjs';

const SAMPLES = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'samples', 'documents');
const student = await session('student');
const verifier = await session('verifier');
const officer = await session('officer');
const admin = await session('admin');

async function ingest(file) {
  const started = Date.now();
  const { id } = await student.upload(join(SAMPLES, file));
  const doc = await waitFor(async () => {
    const s = await student.get(`/documents/${id}/status`);
    return settled(s) && s;
  });
  return { id, doc, ms: Date.now() - started };
}

console.log('\n1. Intake, OCR, classification, extraction');
const marks = await ingest('marksheet.png');
console.log(`   scanned marksheet (Tesseract): ${marks.doc.status} in ${marks.ms} ms`);
check(marks.ms < 60_000, 'single marksheet pipeline under 60 s');
const markDoc = await student.get(`/documents/${marks.id}`);
check(markDoc.documentType === 'marksheet', `classified as marksheet (${markDoc.classification?.confidence})`);
const fields = await student.get(`/documents/${marks.id}/fields`);
const pct = fields.find((f) => f.key === 'percentage');
check(pct && pct.bbox?.length === 4, `percentage read as "${pct?.value}" with a source region`);
check(fields.every((f) => f.status !== 'auto_accepted' || f.confidence.overall >= f.confidence.threshold), 'no field below threshold was auto-accepted');
check(markDoc.authenticity.established === false, 'authenticity reported as NOT established');

const income = await ingest('income_certificate.pdf');
const identity = await ingest('identity.pdf');
const bad = await ingest('marksheet_inconsistent.pdf');
console.log(`   digital PDFs: income ${income.ms} ms, identity ${identity.ms} ms`);
const badDoc = await student.get(`/documents/${bad.id}`);
const pctCheck = badDoc.consistencyChecks.find((c) => c.code === 'percentage_matches_marks');
check(pctCheck?.status === 'fail', `inconsistent marksheet detected: ${pctCheck?.message}`);

console.log('\n2. Human review');
const queue = await verifier.get('/documents/review-queue');
console.log(`   queue: ${queue.length} case(s)`);
for (const d of [marks, income, identity]) {
  await verifier.post(`/documents/${d.id}/claim`).catch(() => undefined);
  const fs = await verifier.get(`/documents/${d.id}/fields`);
  for (const f of fs.filter((f) => f.status === 'needs_review')) {
    if (f.value) await verifier.post(`/documents/${d.id}/fields/${encodeURIComponent(f.key)}/confirm`);
    else await verifier.patch(`/documents/${d.id}/fields/${encodeURIComponent(f.key)}`, { value: 'n/a', reason: 'Entered from document image' });
  }
  const s = await verifier.get(`/documents/${d.id}/status`);
  if (s.status === 'needs_review') await verifier.post(`/documents/${d.id}/review/complete`);
}
check((await verifier.get(`/documents/${marks.id}/status`)).status === 'processed', 'marksheet review completed');

console.log('\n3. Verification');
await verifier.post(`/documents/${marks.id}/verify`);
const sim = await waitFor(async () => {
  const d = await verifier.get(`/documents/${marks.id}`);
  return d.verification.status !== 'pending' && d;
});
check(sim.verification.status === 'simulated_match' && sim.verification.providerLabel.startsWith('SIMULATED'), 'simulated provider result is labelled');
check(sim.authenticity.established === false, 'simulated result does not establish authenticity');
for (const d of [marks, income, identity]) {
  await verifier.post(`/documents/${d.id}/verify/manual`, { outcome: 'match', note: 'Confirmed with issuing office by phone, ref E2E-001' });
}

console.log('\n4. Application, recommendation, decision');
const scholarships = await student.get('/scholarships');
const mcm = scholarships.find((s) => s.code === 'MCM-2026');
const app = await student.post('/applications', { scholarshipId: mcm._id, documentIds: [marks.id, income.id, identity.id] });
const rec = await waitFor(() => student.get(`/applications/${app._id}/recommendation`).catch(() => null));
console.log(`   ${rec.outcome}: ${rec.summary}`);
check(rec.evaluation.children.length === 5 && rec.evaluation.children.every((c) => c.reason), 'every condition listed with its reasoning');
await officer.post(`/applications/${app._id}/decision`, { outcome: 'awarded', note: 'E2E committee approval' });
const csv = await officer.get('/reports/awards.csv');
check(csv.includes('Ananya Sharma'), 'award list export includes the awardee');
const timeline = await officer.get(`/applications/${app._id}/timeline`);
check(['scan', 'ocr', 'classify', 'extract', 'consistency', 'review', 'verify', 'recommendation', 'decision'].every((s) => timeline.some((t) => t.stage === s)), `complete timeline (${timeline.length} events)`);

console.log('\n5. Access control and audit');
const { url } = await student.post(`/documents/${marks.id}/access-url`, { variant: 'preview' });
check(url.startsWith('/api/v1/files/'), 'pre-signed preview URL issued');
const preview = await student.get(url.replace('/api/v1', ''));
check(preview.length > 1000, 'preview served through the signed URL');
const other = await session('student2');
check((await other.get(`/documents/${marks.id}`).catch((e) => e)).status === 404, 'another student cannot see the document');
const views = await admin.get(`/documents/${marks.id}/access-log`);
check(views.length >= 1 && views[0].actorRole === 'student', `document view logged (${views.length})`);
const manual = await admin.get('/admin/audit?action=verification.manual');
check(manual.length >= 3, `manual verifications audited (${manual.length})`);

console.log('\n6. Throughput (batch of 40 digital marksheets)');
const t0 = Date.now();
const ids = await Promise.all(Array.from({ length: 40 }, () => student.upload(join(SAMPLES, 'marksheet.pdf')).then((r) => r.id)));
await waitFor(async () => (await Promise.all(ids.map((id) => student.get(`/documents/${id}/status`)))).every(settled), { timeoutMs: 300_000, everyMs: 1000 });
const perHour = Math.round((40 / ((Date.now() - t0) / 1000)) * 3600);
console.log(`   40 documents in ${Date.now() - t0} ms → ~${perHour} documents/hour`);
check(perHour >= 500, 'throughput ≥ 500 documents/hour');

console.log(failed() ? `\n${failed()} check(s) failed` : '\nAll end-to-end checks passed');
process.exitCode = failed() ? 1 : 0;
