import { z } from 'zod';
import type { Types } from 'mongoose';
import { config } from '../config.js';
import { DocumentModel, ExtractedFieldModel, ProfileMatchModel } from '../models/document.js';
import { UserModel } from '../models/user.js';
import { logger } from '../lib/events.js';
import type { ApplicantDetail } from './applicantDetails.js';

/**
 * Compares what OCR read on a document with the details the applicant gave in their profile. A verdict is
 * advice for the verification officer: any mismatch or unclear result sends the document to review, and nothing
 * here can mark a document genuine.
 */

type Kind = 'name' | 'gender' | 'text';
/** Which extracted fields hold each profile detail, by document field key. Only details found on the document are compared. */
export const MATCH_FIELDS: Array<{ field: ApplicantDetail; label: string; docKeys: string[]; kind: Kind }> = [
  { field: 'name', label: 'Full name', docKeys: ['student_name', 'holder_name', 'full_name'], kind: 'name' },
  { field: 'fatherName', label: "Father's name", docKeys: ['father_name'], kind: 'name' },
  { field: 'motherName', label: "Mother's name", docKeys: ['mother_name'], kind: 'name' },
  { field: 'gender', label: 'Gender', docKeys: ['gender'], kind: 'gender' },
  { field: 'state', label: 'State', docKeys: ['state'], kind: 'text' },
];

export type MatchOutcome = 'match' | 'mismatch' | 'unclear';
export interface MatchPair { field: string; label: string; kind: Kind; documentValue: string; profileValue: string }
export interface Verdict { field: string; outcome: MatchOutcome; reason: string }

export interface Matcher {
  engine: string;
  model?: string;
  compare(pairs: MatchPair[]): Promise<Verdict[]>;
}

const words = (v: string) => v.toUpperCase().normalize('NFKD').replace(/[^A-Z\s]/g, ' ').replace(/\b(MR|MRS|MS|SHRI|SMT|KUMARI|KU|LATE|DR)\b/g, ' ').split(/\s+/).filter(Boolean);
const gender = (v: string) => {
  const g = v.trim().toUpperCase();
  return g.startsWith('F') ? 'female' : g.startsWith('M') ? 'male' : g ? 'other' : '';
};

/** True when `short` could be an abbreviation of `long`: same first letter, its letters appear in order, and it is clearly shorter (MOHD → MOHAMMED, KR → KUMAR). */
const abbreviates = (short: string, long: string) => {
  if (short.length < 2 || long.length < short.length + 2 || short[0] !== long[0]) return false;
  let i = 0;
  for (const ch of long) if (ch === short[i]) i++;
  return i === short.length;
};

/** The first abbreviated word between two names (after setting aside the words they share), e.g. ['MOHD', 'MOHAMMED']. */
export function abbreviatedWord(a: string, b: string): [string, string] | null {
  const x = words(a);
  const y = words(b);
  const onlyX = x.filter((w) => !y.includes(w));
  const onlyY = y.filter((w) => !x.includes(w));
  for (const s of onlyX) for (const l of onlyY) if (abbreviates(s, l)) return [s, l];
  for (const s of onlyY) for (const l of onlyX) if (abbreviates(s, l)) return [s, l];
  return null;
}

/**
 * Names must be exactly the same: the same words in the same order. Only letter case, spacing, punctuation and
 * titles (Shri, Smt, Kumari, Mr, Mrs, Ms, Dr, Late) are ignored. The reason says what differs.
 */
export function exactName(documentValue: string, profileValue: string): { outcome: 'match' | 'mismatch'; reason: string } {
  const doc = words(documentValue);
  const prof = words(profileValue);
  if (doc.join(' ') === prof.join(' ')) return { outcome: 'match', reason: 'Exactly the same name' };
  const abbr = abbreviatedWord(documentValue, profileValue);
  if (abbr) return { outcome: 'mismatch', reason: `"${abbr[0]}" is an abbreviation, not the same as "${abbr[1]}"` };
  const missing = prof.filter((w) => !doc.includes(w));
  const extra = doc.filter((w) => !prof.includes(w));
  if (!missing.length && !extra.length) return { outcome: 'mismatch', reason: 'The same words in a different order' };
  if (missing.length && !extra.length) return { outcome: 'mismatch', reason: `Missing on the document: ${missing.join(' ')}` };
  if (extra.length && !missing.length) return { outcome: 'mismatch', reason: `Not in the profile: ${extra.join(' ')}` };
  return { outcome: 'mismatch', reason: `Spelled differently: ${extra.join(' ')} on the document, ${missing.join(' ')} in the profile` };
}

/** Rule-based comparison: names must be exactly the same (see exactName); gender is compared by meaning. */
export class BasicMatcher implements Matcher {
  readonly engine = 'basic';
  async compare(pairs: MatchPair[]): Promise<Verdict[]> {
    return pairs.map((p) => {
      if (p.kind === 'gender') {
        const same = gender(p.documentValue) === gender(p.profileValue);
        return { field: p.field, outcome: same ? 'match' : 'mismatch', reason: same ? 'Same gender' : 'The document shows a different gender' };
      }
      return { field: p.field, ...exactName(p.documentValue, p.profileValue) };
    });
  }
}

const groqReply = z.object({
  results: z.array(z.object({ field: z.string(), outcome: z.enum(['match', 'mismatch', 'unclear']), reason: z.string().max(300) })),
});

const SYSTEM_PROMPT = `You compare personal details read by OCR from an Indian scholarship document with the details the applicant entered in their profile.
Names must be EXACTLY the same: the same words, spelled the same way, in the same order. Ignore only letter case, spacing, punctuation and titles (Shri, Smt, Kumari, Mr, Mrs, Ms, Dr, Late).
Anything else is a "mismatch": a missing or extra word (e.g. the surname missing), initials (A. Sharma), abbreviations (Mohd is NOT Mohammed), different spellings, or a different order.
For gender, "match" when both mean the same gender (F = female, M = male).
For each field give "match" or "mismatch" and a short reason naming what differs.
Reply with JSON only: {"results":[{"field":"<field>","outcome":"match|mismatch","reason":"<one short sentence>"}]} with exactly one entry per field given. Do not add fields.`;

/** Groq's OpenAI-compatible chat API with JSON output. The document image is never sent, only the compared values. */
export class GroqMatcher implements Matcher {
  readonly engine = 'groq';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs = 15_000,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = 'https://api.groq.com/openai/v1',
  ) {}

  async compare(pairs: MatchPair[]): Promise<Verdict[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ fields: pairs.map(({ field, label, documentValue, profileValue }) => ({ field, label, document: documentValue, profile: profileValue })) }) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Groq API ${res.status}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = groqReply.parse(JSON.parse(body.choices?.[0]?.message?.content ?? '{}'));
    // Exactly one verdict per field asked about; anything missing is left for the officer. For names the exact rule
    // decides (the model cannot accept a near miss); the model's wording is kept only when it reached the same result.
    return pairs.map((p) => {
      const v: Verdict = parsed.results.find((r) => r.field === p.field) ?? { field: p.field, outcome: 'unclear', reason: 'No answer for this field' };
      if (p.kind !== 'name') return v;
      const rule = exactName(p.documentValue, p.profileValue);
      return { field: p.field, outcome: rule.outcome, reason: v.outcome === rule.outcome ? v.reason : rule.reason };
    });
  }
}

let override: Matcher | undefined;
/** For tests: replace the configured matcher. */
export const setMatcher = (m?: Matcher) => void (override = m);

export function matcher(): Matcher {
  if (override) return override;
  const c = config();
  return c.PROFILE_MATCH_PROVIDER === 'groq' && c.GROQ_API_KEY ? new GroqMatcher(c.GROQ_API_KEY, c.GROQ_MODEL, c.GROQ_TIMEOUT_MS) : new BasicMatcher();
}

/** Builds the pairs to compare, runs the matcher (falling back to the rule-based one if it fails) and stores the result. */
export async function matchDocumentToProfile(documentId: Types.ObjectId | string) {
  const doc = await DocumentModel.findById(documentId).lean();
  if (!doc) return null;
  const [owner, fields] = await Promise.all([UserModel.findById(doc.owner).lean(), ExtractedFieldModel.find({ document: doc._id }).lean()]);
  const read = new Map(fields.filter((f) => f.value).map((f) => [f.key, String(f.value)]));
  const pairs: MatchPair[] = [];
  for (const m of MATCH_FIELDS) {
    const profileValue = m.field === 'name' ? owner?.name : owner?.profile?.[m.field as 'fatherName'];
    const key = m.docKeys.find((k) => read.has(k));
    if (profileValue && key) pairs.push({ field: m.field, label: m.label, kind: m.kind, documentValue: read.get(key)!, profileValue });
  }

  let engine = 'basic';
  let model: string | undefined;
  let note: string | undefined;
  let verdicts: Verdict[] = [];
  if (!pairs.length) {
    note = 'Nothing on this document to compare with the profile';
  } else {
    const m = matcher();
    try {
      verdicts = await m.compare(pairs);
      engine = m.engine;
      model = m.model;
    } catch (err) {
      logger.warn({ err, documentId: String(doc._id) }, 'profile match: matcher failed, using rule-based comparison');
      verdicts = await new BasicMatcher().compare(pairs);
      note = `${m.engine === 'groq' ? 'Groq' : m.engine} was unavailable (${(err as Error).message}); compared with exact rules instead`;
    }
  }
  const results = pairs.map((p) => {
    const v = verdicts.find((x) => x.field === p.field)!;
    return { field: p.field, label: p.label, documentValue: p.documentValue, profileValue: p.profileValue, outcome: v.outcome, reason: v.reason };
  });
  return ProfileMatchModel.findOneAndUpdate(
    { document: doc._id },
    { $set: { engine, model, note, results, checkedAt: new Date() } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
}

export const needsOfficer = (m?: { results?: Array<{ outcome?: string | null }> } | null) => Boolean(m?.results?.some((r) => r.outcome !== 'match'));
