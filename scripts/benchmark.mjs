// Field-level extraction accuracy against a labelled set.
// Usage: node scripts/benchmark.mjs [labels.json] [documents-dir]
// labels.json maps a file stem to { documentType, fields: {key: expected}, consistency?: {code: status} }.
// Each stem is benchmarked for every file that exists (<stem>.pdf, <stem>.png). Point this at the
// client-supplied 200-document set to produce the acceptance report.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { session, settled, waitFor } from './lib.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'samples');
const labelsPath = process.argv[2] ?? join(root, 'labels.json');
const docsDir = process.argv[3] ?? join(root, 'documents');
const labels = JSON.parse(await readFile(labelsPath, 'utf8'));
const student = await session('student');

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const perField = {};
const rows = [];
let classified = 0;
let total = 0;

for (const [stem, label] of Object.entries(labels)) {
  for (const ext of ['pdf', 'png']) {
    const file = join(docsDir, `${stem}.${ext}`);
    if (!existsSync(file)) continue;
    total++;
    const { id } = await student.upload(file);
    await waitFor(async () => settled(await student.get(`/documents/${id}/status`)));
    const doc = await student.get(`/documents/${id}`);
    const fields = Object.fromEntries((await student.get(`/documents/${id}/fields`)).map((f) => [f.key, f]));
    if (doc.documentType === label.documentType) classified++;
    for (const [key, expected] of Object.entries(label.fields)) {
      const got = fields[key];
      const ok = norm(got?.value) === norm(expected);
      const k = `${label.documentType}.${key.replace(/\.\d+\./, '.*.')}`;
      perField[k] ??= { correct: 0, total: 0, flaggedWhenWrong: 0, wrong: 0 };
      perField[k].total++;
      if (ok) perField[k].correct++;
      else {
        perField[k].wrong++;
        if (!got || got.status === 'needs_review') perField[k].flaggedWhenWrong++;
      }
      rows.push({ file: `${stem}.${ext}`, field: key, expected, got: got?.value ?? null, confidence: got?.confidence?.overall ?? 0, status: got?.status ?? 'missing', ok });
    }
    for (const [code, status] of Object.entries(label.consistency ?? {})) {
      const c = doc.consistencyChecks.find((x) => x.code === code);
      rows.push({ file: `${stem}.${ext}`, field: `check:${code}`, expected: status, got: c?.status ?? null, ok: c?.status === status });
    }
  }
}

const fieldRows = rows.filter((r) => !r.field.startsWith('check:'));
const accuracy = fieldRows.filter((r) => r.ok).length / fieldRows.length;
const silentErrors = fieldRows.filter((r) => !r.ok && r.status !== 'needs_review' && r.status !== 'missing').length;
const lines = [
  '# Extraction accuracy benchmark',
  '',
  `Generated ${new Date().toISOString()} against ${relative(join(root, '..'), labelsPath)}`,
  '',
  `- Documents: ${total} · classification accuracy: ${((classified / total) * 100).toFixed(1)}%`,
  `- Field-level accuracy: **${(accuracy * 100).toFixed(1)}%** (${fieldRows.filter((r) => r.ok).length}/${fieldRows.length}) — acceptance target ≥ 90% on standard marksheets`,
  `- Wrong values that were NOT routed to review (silent errors): **${silentErrors}**`,
  `- Consistency checks matching labels: ${rows.filter((r) => r.field.startsWith('check:') && r.ok).length}/${rows.filter((r) => r.field.startsWith('check:')).length}`,
  '',
  '| Field | Correct | Total | Accuracy | Wrong but flagged for review |',
  '|---|---:|---:|---:|---:|',
  ...Object.entries(perField).map(([k, v]) => `| ${k} | ${v.correct} | ${v.total} | ${((v.correct / v.total) * 100).toFixed(1)}% | ${v.flaggedWhenWrong}/${v.wrong} |`),
  '',
  '## Mismatches',
  '',
  '| File | Field | Expected | Extracted | Confidence | Status |',
  '|---|---|---|---|---:|---|',
  ...rows.filter((r) => !r.ok).map((r) => `| ${r.file} | ${r.field} | ${r.expected} | ${r.got ?? '—'} | ${r.confidence ?? ''} | ${r.status ?? ''} |`),
];
const out = join(root, '..', 'docs', 'benchmark-report.md');
await writeFile(out, lines.join('\n') + '\n');
console.log(lines.slice(0, 9).join('\n'));
console.log(`\nReport written to ${out}`);
