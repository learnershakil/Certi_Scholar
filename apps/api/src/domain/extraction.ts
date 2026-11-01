import type { OcrResult, OcrWord } from '../ocr/client.js';

/** M3 — classification and M4 — field extraction with per-field confidence. Pure functions over OCR output. */

export type FieldKind = 'text' | 'number' | 'date' | 'id';

export interface ProfileField {
  key: string;
  label: string;
  kind: FieldKind;
  pattern: string;
  required: boolean;
  threshold?: number | null;
}

export interface Profile {
  format?: string | null;
  version?: number | null;
  fields: ProfileField[];
  table?: {
    key?: string | null;
    label?: string | null;
    rowPattern?: string | null;
    columns: Array<{ key?: string | null; kind?: string | null; fixed?: string | null }>;
  } | null;
}

export interface ExtractedValue {
  key: string;
  label: string;
  kind: FieldKind;
  group?: string;
  row?: number;
  value: string | null;
  page: number;
  bbox?: [number, number, number, number];
  confidence: { ocr: number; pattern: number; overall: number; threshold: number };
  status: 'auto_accepted' | 'needs_review';
  required: boolean;
}

export interface DocumentTypeDef {
  code: string;
  keywords: Array<{ term?: string | null; weight?: number | null }>;
}

export const fullText = (ocr: OcrResult) => ocr.pages.flatMap((p) => p.lines.map((l) => l.text)).join('\n');

export function classify(text: string, types: DocumentTypeDef[], threshold: number) {
  const haystack = text.toLowerCase();
  const scores: Record<string, number> = {};
  for (const t of types) {
    const total = t.keywords.reduce((s, k) => s + (k.weight ?? 1), 0);
    // A term may list synonyms separated by `|` ("roll number|unique id"): any one of them counts once.
    const found = (term: string) => term.toLowerCase().split('|').some((alt) => haystack.includes(alt.trim()));
    const hit = t.keywords.filter((k) => k.term && found(k.term)).reduce((s, k) => s + (k.weight ?? 1), 0);
    scores[t.code] = total ? Math.round((hit / total) * 1000) / 1000 : 0;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  const confidence = top?.[1] ?? 0;
  // A near-tie between two types is ambiguous: a human decides rather than the system guessing.
  const ambiguous = second !== undefined && confidence - second[1] < 0.15;
  return { documentType: top && confidence >= threshold && !ambiguous ? top[0] : null, confidence, scores };
}

export function isValidKind(kind: FieldKind | string, value: string): boolean {
  const v = value.trim();
  switch (kind) {
    case 'number':
      return /^(?:₹|Rs\.?)?\s*\d[\d,]*(?:\.\d+)?%?$/i.test(v);
    case 'date': {
      const m = v.match(/^(\d{2})[/.-](\d{2})[/.-](\d{4})$/);
      if (!m) return false;
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      return d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1;
    }
    case 'id':
      return /^[A-Z0-9][A-Z0-9 /-]{3,}$/i.test(v);
    default:
      return /\p{L}/u.test(v);
  }
}

interface IndexedLine {
  page: number;
  text: string;
  words: OcrWord[];
  spans: Array<[number, number]>;
}

function indexLines(ocr: OcrResult): IndexedLine[] {
  return ocr.pages.flatMap((p) =>
    p.lines.map((l) => {
      const spans: Array<[number, number]> = [];
      let text = '';
      for (const w of l.words) {
        if (text) text += ' ';
        spans.push([text.length, text.length + w.text.length]);
        text += w.text;
      }
      return { page: p.index, text, words: l.words, spans };
    }),
  );
}

function locate(line: IndexedLine, start: number, end: number) {
  const words = line.words.filter((_, i) => line.spans[i][0] < end && line.spans[i][1] > start);
  if (!words.length) return { conf: 0, bbox: undefined };
  const bbox: [number, number, number, number] = [
    Math.min(...words.map((w) => w.bbox[0])),
    Math.min(...words.map((w) => w.bbox[1])),
    Math.max(...words.map((w) => w.bbox[2])),
    Math.max(...words.map((w) => w.bbox[3])),
  ];
  return { conf: Math.min(...words.map((w) => w.conf)), bbox };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function build(
  meta: { key: string; label: string; kind: FieldKind; required: boolean; group?: string; row?: number },
  threshold: number,
  hit?: { value: string; page: number; conf: number; bbox?: [number, number, number, number] },
): ExtractedValue {
  if (!hit) {
    return { ...meta, value: null, page: 0, confidence: { ocr: 0, pattern: 0, overall: 0, threshold }, status: 'needs_review' };
  }
  const pattern = isValidKind(meta.kind, hit.value) ? 1 : 0;
  const overall = round(hit.conf * pattern);
  return {
    ...meta,
    value: hit.value.trim(),
    page: hit.page,
    bbox: hit.bbox,
    confidence: { ocr: round(hit.conf), pattern, overall, threshold },
    status: overall >= threshold ? 'auto_accepted' : 'needs_review',
  };
}

/**
 * Extracts every profile field. A field that is missing, fails its type check, or falls below its
 * confidence threshold is returned as `needs_review` — the extractor never fills a value it did not read.
 */
export function extractFields(ocr: OcrResult, profile: Profile, defaultThreshold: number): ExtractedValue[] {
  const lines = indexLines(ocr);
  const out: ExtractedValue[] = [];

  for (const f of profile.fields) {
    const re = new RegExp(f.pattern, 'id');
    let hit: Parameters<typeof build>[2];
    for (const line of lines) {
      const m = re.exec(line.text);
      if (m?.indices?.[1] && m[1]) {
        const [s, e] = m.indices[1];
        hit = { value: m[1], page: line.page, ...locate(line, s, e) };
        break;
      }
    }
    const threshold = f.threshold ?? defaultThreshold;
    if (!hit && !f.required) continue;
    out.push(build({ key: f.key, label: f.label, kind: f.kind, required: f.required }, threshold, hit));
  }

  const t = profile.table;
  if (t?.rowPattern && t.key) {
    const re = new RegExp(t.rowPattern, 'id');
    const matched = lines.map((line) => re.exec(line.text));
    const first = matched.findIndex(Boolean);
    const last = matched.findLastIndex(Boolean);
    let row = 0;
    for (let i = first; first >= 0 && i <= last; i++) {
      const line = lines[i];
      const m = matched[i];
      // A line inside the table that OCR could barely read may be a whole subject: it becomes an empty row
      // for the officer to fill, instead of being dropped from the totals without anyone noticing.
      const unreadable = !m && line.words.length > 0 && line.words.reduce((s, w) => s + w.conf, 0) / line.words.length < UNREADABLE_LINE;
      if (!m && !unreadable) continue;
      let group = 1;
      for (const c of t.columns) {
        const meta = { key: `${t.key}.${row}.${c.key}`, label: `${t.label ?? t.key} ${row + 1} — ${c.key}`, kind: (c.kind as FieldKind) ?? 'text', required: true, group: t.key!, row };
        if (c.fixed) {
          out.push(build({ ...meta, label: `${meta.label} (set by format)` }, defaultThreshold, { value: c.fixed, page: line.page, conf: 1 }));
          continue;
        }
        const idx = m?.indices?.[group];
        const value = m?.[group];
        group++;
        const hit = idx && value ? { value, page: line.page, ...locate(line, idx[0], idx[1]) } : undefined;
        const field = build(meta, defaultThreshold, hit);
        // Point the officer at the unreadable line even though no value was read from it.
        if (unreadable) Object.assign(field, { page: line.page, bbox: locate(line, 0, line.text.length).bbox, label: `${meta.label} (line unreadable)` });
        out.push(field);
      }
      row++;
    }
  }
  return out;
}

/** Mean word confidence below which a line inside a table is treated as an unreadable row. */
const UNREADABLE_LINE = 0.5;

/**
 * A document type can have several layouts. Every active format is tried and the one that finds the
 * largest share of its required fields wins; ties go to the higher average confidence.
 */
export function pickBestProfile<P extends Profile>(ocr: OcrResult, profiles: P[], defaultThreshold: number) {
  let best: { profile: P; values: ExtractedValue[]; coverage: number; meanConfidence: number } | undefined;
  for (const profile of profiles) {
    const values = extractFields(ocr, profile, defaultThreshold);
    const required = profile.fields.filter((f) => f.required);
    const found = required.filter((f) => values.some((v) => v.key === f.key && v.value !== null)).length;
    const tableFound = values.some((v) => v.group && v.value !== null && !v.label.endsWith('(set by format)')) ? 1 : 0;
    const coverage = (found + tableFound) / (required.length + (profile.table?.rowPattern ? 1 : 0) || 1);
    const read = values.filter((v) => v.value !== null);
    const meanConfidence = read.length ? read.reduce((s, v) => s + v.confidence.overall, 0) / read.length : 0;
    if (!best || coverage > best.coverage || (coverage === best.coverage && meanConfidence > best.meanConfidence)) {
      best = { profile, values, coverage: Math.round(coverage * 1000) / 1000, meanConfidence };
    }
  }
  return best;
}
