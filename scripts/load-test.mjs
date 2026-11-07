// Performance benchmark: uploads documents concurrently through the API and measures how long each takes to
// be scanned, read and analysed, plus overall throughput, against the targets in the brief:
//   - one document fully processed within 60 s
//   - at least 500 documents per hour
//
// Usage:  node scripts/load-test.mjs [--docs 40] [--concurrency 8] [--target-seconds 60] [--target-per-hour 500]
//                                    [--dir samples/documents] [--report docs/performance-report.md]
// Needs the stack running (docker compose up -d) and the demo accounts (SEED_DEMO=true at first start).
// Every upload is a real document owned by the demo student, so run it on a test stack, not on live data.
// With PROFILE_MATCH_PROVIDER=groq each document also makes one Groq request; mind your Groq rate limits.
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, session, settled } from './lib.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DOCS = Number(arg('docs', 40));
const CONCURRENCY = Number(arg('concurrency', 8));
const TARGET_MS = Number(arg('target-seconds', 60)) * 1000;
const TARGET_PER_HOUR = Number(arg('target-per-hour', 500));
const DIR = arg('dir', join(root, 'samples', 'documents'));
const REPORT = arg('report', join(root, 'docs', 'performance-report.md'));
const POLL_MS = 500;
const GIVE_UP_MS = 10 * 60_000;

const files = (await readdir(DIR)).filter((f) => /\.(pdf|png|jpe?g)$/i.test(f)).sort().map((f) => join(DIR, f));
if (!files.length) throw new Error(`No PDF/PNG/JPEG files in ${DIR}`);

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);
const s = (ms) => `${(ms / 1000).toFixed(1)} s`;

console.log(`Load test against ${BASE}: ${DOCS} documents, ${CONCURRENCY} at a time, from ${files.length} sample file(s)`);
const student = await session('student');
const results = [];
let next = 0;
const started = Date.now();

/** One worker: upload, then poll until the document leaves queued/processing. */
async function worker() {
  for (;;) {
    const n = next++;
    if (n >= DOCS) return;
    const file = files[n % files.length];
    const t0 = Date.now();
    const row = { n: n + 1, file: file.split(/[\\/]/).pop() };
    try {
      const { id } = await student.upload(file);
      row.uploadMs = Date.now() - t0;
      let doc;
      for (;;) {
        doc = await student.get(`/documents/${id}/status`);
        if (settled(doc) || Date.now() - t0 > GIVE_UP_MS) break;
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      row.totalMs = Date.now() - t0;
      row.status = doc.status;
      row.stages = Object.fromEntries((doc.stages ?? []).map((st) => [st.name, st.startedAt && st.finishedAt ? new Date(st.finishedAt) - new Date(st.startedAt) : null]));
    } catch (err) {
      row.totalMs = Date.now() - t0;
      row.status = 'error';
      row.error = err.message;
    }
    results.push(row);
    process.stdout.write(`  ${String(row.n).padStart(3)} ${row.file.padEnd(28)} ${row.status.padEnd(13)} ${s(row.totalMs)}\n`);
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, DOCS) }, worker));
const elapsed = Date.now() - started;

const done = results.filter((r) => ['processed', 'needs_review'].includes(r.status));
const failedRows = results.filter((r) => !['processed', 'needs_review'].includes(r.status));
const times = done.map((r) => r.totalMs).sort((a, b) => a - b);
const perHour = Math.round((done.length / elapsed) * 3_600_000);
const stageNames = ['ocr', 'classify', 'extract', 'consistency'];
const stageStats = stageNames.map((name) => {
  const v = done.map((r) => r.stages?.[name]).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return { name, p50: pct(v, 50), p95: pct(v, 95), max: v.at(-1) ?? 0 };
});

const checks = [
  { label: `Each document processed within ${TARGET_MS / 1000} s (p95)`, ok: times.length > 0 && pct(times, 95) <= TARGET_MS, value: s(pct(times, 95)) },
  { label: `Throughput at least ${TARGET_PER_HOUR} documents/hour`, ok: perHour >= TARGET_PER_HOUR, value: `${perHour}/hour` },
  { label: 'No document failed or timed out', ok: failedRows.length === 0, value: `${failedRows.length} failed` },
];

console.log(`
Processed      ${done.length} of ${DOCS} in ${s(elapsed)}  (${failedRows.length} failed)
Latency        p50 ${s(pct(times, 50))}   p95 ${s(pct(times, 95))}   max ${s(times.at(-1) ?? 0)}
Throughput     ${perHour} documents/hour at concurrency ${CONCURRENCY}
Stages (p95)   ${stageStats.map((x) => `${x.name} ${s(x.p95)}`).join('   ')}
`);
for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}: ${c.value}`);

const report = `# Performance report

Generated ${new Date().toISOString()} by \`scripts/load-test.mjs\` against ${BASE}.

| Setting | Value |
|---|---|
| Documents | ${DOCS} (from ${files.length} sample files in \`${DIR.replace(root, '.')}\`) |
| Concurrency | ${CONCURRENCY} uploads at a time |
| Wall-clock time | ${s(elapsed)} |

## Results

| Check | Result | Measured |
|---|---|---|
${checks.map((c) => `| ${c.label} | ${c.ok ? 'Pass' : '**Fail**'} | ${c.value} |`).join('\n')}

| Upload to settled | p50 | p95 | max |
|---|---|---|---|
| End to end | ${s(pct(times, 50))} | ${s(pct(times, 95))} | ${s(times.at(-1) ?? 0)} |
${stageStats.map((x) => `| ${x.name} stage | ${s(x.p50)} | ${s(x.p95)} | ${s(x.max)} |`).join('\n')}

Throughput: **${perHour} documents/hour** (${done.length} settled in ${s(elapsed)}).
${failedRows.length ? `\n## Failures\n\n${failedRows.map((r) => `- #${r.n} ${r.file}: ${r.status}${r.error ? ` (${r.error})` : ''}`).join('\n')}\n` : ''}
"Settled" means the document finished processing: \`processed\`, or \`needs_review\` when a field or a profile
detail needs an officer. Times include the malware scan, encrypted storage, OCR, classification, extraction,
consistency checks and the profile match.
`;
await writeFile(REPORT, report);
console.log(`\nReport written to ${REPORT.replace(root, '.')}`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
