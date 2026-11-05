import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScholarshipModel } from '../src/models/scholarship.js';
import { fakeOcr, INCOME, MARKSHEET, png, startHarness, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

type Node = { label: string; outcome: string; fact?: string; actual?: unknown; children?: Node[] };
const find = (n: Node, fact: string): Node | undefined => (n.fact === fact ? n : n.children?.map((c) => find(c, fact)).find(Boolean));

describe('scholarship overview for the student dashboard', () => {
  it('summarises each open scholarship with its criteria in plain language', async () => {
    const student = await h.login('student');
    const { body } = await student.get('/api/v1/scholarships/overview').expect(200);
    const mcm = body.find((s: { code: string }) => s.code === 'MCM-2026');
    expect(mcm).toMatchObject({ name: 'Merit-cum-Means Scholarship 2026', amount: 50000, requiredDocuments: ['marksheet', 'income_certificate'], ruleVersion: 1 });
    expect(mcm.criteria.children).toHaveLength(5);
    expect(find(mcm.criteria, 'income.annualIncome')!.label).toMatch(/at most 250000/);
    expect(mcm.officers).toBeUndefined(); // staff details are not part of the student view
  });

  it('checks profile criteria against the student and leaves document criteria undetermined', async () => {
    const [ananya, arjun] = await Promise.all([h.login('student'), h.login('student2')]);
    const stem = async (s: typeof ananya) => (await s.get('/api/v1/scholarships/overview').expect(200)).body.find((x: { code: string }) => x.code === 'GSTEM-2026').criteria;
    const [a, b] = await Promise.all([stem(ananya), stem(arjun)]);
    expect(find(a, 'applicant.gender')!.outcome).toBe('pass');
    expect(find(b, 'applicant.gender')!.outcome).toBe('fail');
    expect(find(a, 'marksheet.percentage')!.outcome).toBe('unknown'); // only reviewed documents decide this
  });

  it('checks document criteria against the student’s own processed documents, with the values found', async () => {
    h.ocr.results.set('ovm', fakeOcr(MARKSHEET));
    h.ocr.results.set('ovi', fakeOcr(INCOME));
    const arjun = await h.login('student2');
    for (const m of ['ovm', 'ovi']) await arjun.post('/api/v1/documents').attach('file', png(m), `${m}.png`).expect(202);
    await h.queue.drain();

    const mcm = (await arjun.get('/api/v1/scholarships/overview').expect(200)).body.find((s: { code: string }) => s.code === 'MCM-2026').criteria;
    expect(find(mcm, 'marksheet.percentage')).toMatchObject({ outcome: 'pass', actual: 88.2 });
    expect(find(mcm, 'income.annualIncome')).toMatchObject({ outcome: 'pass', actual: 240000 });
    expect(find(mcm, 'documents.authenticityEstablished')!.outcome).toBe('fail'); // not yet confirmed by an issuer

    // Other students never see Arjun's values.
    const ananya = (await (await h.login('student')).get('/api/v1/scholarships/overview').expect(200)).body.find((s: { code: string }) => s.code === 'MCM-2026').criteria;
    expect(find(ananya, 'marksheet.percentage')!.outcome).toBe('unknown');
  });

  it('lists only scholarships that are currently available: active and before their deadline', async () => {
    const student = await h.login('student');
    const codes = async () => (await student.get('/api/v1/scholarships/overview').expect(200)).body.map((s: { code: string }) => s.code).sort();

    await ScholarshipModel.updateOne({ code: 'GSTEM-2026' }, { active: false });
    expect(await codes()).toEqual(['MCM-2026']);
    await ScholarshipModel.updateOne({ code: 'GSTEM-2026' }, { active: true, deadline: new Date(Date.now() - 86_400_000) });
    expect(await codes()).toEqual(['MCM-2026']);
    await ScholarshipModel.updateOne({ code: 'GSTEM-2026' }, { deadline: new Date(Date.now() + 86_400_000) });
    expect(await codes()).toEqual(['GSTEM-2026', 'MCM-2026']);
    await ScholarshipModel.updateOne({ code: 'GSTEM-2026' }, { $unset: { deadline: 1 } });
  });
});
