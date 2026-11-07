import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BasicMatcher, GroqMatcher, setMatcher, type MatchPair } from '../src/services/profileMatch.js';
import { DocumentModel } from '../src/models/document.js';
import { fakeOcr, IDENTITY, png, startHarness, type Harness } from './helpers.js';

const pair = (field: string, documentValue: string, profileValue: string, kind: MatchPair['kind'] = 'name'): MatchPair => ({ field, label: field, kind, documentValue, profileValue });

describe('rule-based matcher', () => {
  const m = new BasicMatcher();
  it.each([
    ['ANANYA SHARMA', 'Ananya Sharma', 'match'],
    ['ANANYA  SHARMA.', 'Ananya Sharma', 'match'], // spacing and punctuation only
    ['Kumari Ananya Sharma', 'Ananya Sharma', 'match'], // a title is not part of the name
    ['SHARMA ANANYA', 'Ananya Sharma', 'mismatch'],
    ['ANANYA', 'Ananya Sharma', 'mismatch'], // surname missing
    ['A. SHARMA', 'Ananya Sharma', 'mismatch'],
    ['MOHD ARIF', 'Mohammed Arif', 'mismatch'],
    ['MD ARIF', 'Muhammad Arif', 'mismatch'],
    ['RAJESH KR SHARMA', 'Rajesh Kumar Sharma', 'mismatch'],
    ['SHRI RAMESH KUMAR', 'Ramesh Kumar', 'match'],
    ['RAHUL MEHTA', 'Ananya Sharma', 'mismatch'],
  ])('%s vs %s → %s', async (doc, profile, outcome) => {
    expect((await m.compare([pair('name', doc, profile)]))[0].outcome).toBe(outcome);
  });
  it('says exactly what differs', async () => {
    const reasons = (await m.compare([
      pair('name', 'ANANYA', 'Ananya Sharma'),
      pair('name', 'ANANYA KUMARI SHARMA', 'Ananya Sharma'),
      pair('name', 'SHARMA ANANYA', 'Ananya Sharma'),
      pair('name', 'ANANIYA SHARMA', 'Ananya Sharma'),
    ])).map((v) => v.reason);
    expect(reasons).toEqual([
      'Missing on the document: SHARMA',
      'Exactly the same name', // Kumari is a title, so this one matches
      'The same words in a different order',
      'Spelled differently: ANANIYA on the document, ANANYA in the profile',
    ]);
  });

  it('compares gender by meaning', async () => {
    const [a, b] = await m.compare([pair('gender', 'F', 'female', 'gender'), pair('gender', 'Male', 'female', 'gender')]);
    expect([a.outcome, b.outcome]).toEqual(['match', 'mismatch']);
  });
});

describe('Groq matcher', () => {
  const reply = (content: unknown, status = 200) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status });

  it('sends only the compared values, asks for JSON, and returns one verdict per field', async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return reply({ results: [{ field: 'name', outcome: 'match', reason: 'Same name, transliterated' }] });
    }) as unknown as typeof fetch;
    const verdicts = await new GroqMatcher('gsk_test', 'llama-3.3-70b-versatile', 5000, fetchImpl).compare([pair('name', 'MOHD ARIF', 'Mohammed Arif'), pair('fatherName', 'X', 'Y')]);
    expect(sent!.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((sent!.init.headers as Record<string, string>).authorization).toBe('Bearer gsk_test');
    const body = JSON.parse(String(sent!.init.body));
    expect(body).toMatchObject({ model: 'llama-3.3-70b-versatile', temperature: 0, response_format: { type: 'json_object' } });
    expect(JSON.parse(body.messages[1].content)).toEqual({ fields: [{ field: 'name', label: 'name', document: 'MOHD ARIF', profile: 'Mohammed Arif' }, { field: 'fatherName', label: 'fatherName', document: 'X', profile: 'Y' }] });
    expect(verdicts).toEqual([
      // The model called it a match; an abbreviated name is never accepted as the full one.
      { field: 'name', outcome: 'mismatch', reason: '"MOHD" is an abbreviation, not the same as "MOHAMMED"' },
      { field: 'fatherName', outcome: 'mismatch', reason: 'Spelled differently: X on the document, Y in the profile' }, // unanswered names are decided by the exact rule
    ]);
  });

  it('overrules the model when a surname is missing', async () => {
    const fetchImpl = (async () => reply({ results: [{ field: 'name', outcome: 'match', reason: 'Probably the same person' }] })) as unknown as typeof fetch;
    const [v] = await new GroqMatcher('k', 'm', 5000, fetchImpl).compare([pair('name', 'ANANYA', 'Ananya Sharma')]);
    expect(v).toEqual({ field: 'name', outcome: 'mismatch', reason: 'Missing on the document: SHARMA' });
  });

  it('keeps the model’s match when the names really are the same', async () => {
    const fetchImpl = (async () => reply({ results: [{ field: 'name', outcome: 'match', reason: 'Honorific ignored' }] })) as unknown as typeof fetch;
    const [v] = await new GroqMatcher('k', 'm', 5000, fetchImpl).compare([pair('name', 'SHRI RAMESH KUMAR', 'Ramesh Kumar')]);
    expect(v).toEqual({ field: 'name', outcome: 'match', reason: 'Honorific ignored' });
  });

  it('fails loudly on an error or a malformed answer, so the caller can fall back', async () => {
    const down = (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    await expect(new GroqMatcher('k', 'm', 5000, down).compare([pair('name', 'A', 'B')])).rejects.toThrow(/Groq API 429/);
    const odd = (async () => reply({ results: [{ field: 'name', outcome: 'probably' }] })) as unknown as typeof fetch;
    await expect(new GroqMatcher('k', 'm', 5000, odd).compare([pair('name', 'A', 'B')])).rejects.toThrow();
  });
});

describe('matching documents to the applicant profile', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    h.ocr.results.set('pmid', fakeOcr(IDENTITY)); // Name: ANANYA SHARMA · Gender: Female
  });
  afterAll(() => h.stop());
  afterEach(() => setMatcher(undefined));

  const upload = async (who: 'student' | 'student2') => {
    const agent = await h.login(who);
    const id = (await agent.post('/api/v1/documents').attach('file', png('pmid'), 'id.png').expect(202)).body.id as string;
    await h.queue.drain();
    return { agent, id };
  };

  it('records a match when the document agrees with the profile', async () => {
    const { agent, id } = await upload('student');
    const m = (await agent.get(`/api/v1/documents/${id}/profile-match`).expect(200)).body;
    expect(m.engine).toBe('basic');
    expect(m.results.map((r: { field: string; outcome: string }) => [r.field, r.outcome])).toEqual([['name', 'match'], ['gender', 'match']]);
    expect((await DocumentModel.findById(id).lean())!.status).toBe('processed');
  });

  it('sends a document with someone else’s details to an officer', async () => {
    const { agent, id } = await upload('student2'); // Arjun uploads Ananya's card
    const m = (await agent.get(`/api/v1/documents/${id}/profile-match`).expect(200)).body;
    expect(m.results.find((r: { field: string }) => r.field === 'name')).toMatchObject({ outcome: 'mismatch', documentValue: 'ANANYA SHARMA', profileValue: 'Arjun Verma' });
    expect((await DocumentModel.findById(id).lean())!.status).toBe('needs_review');
  });

  it('falls back to exact rules, and says so, when the matcher is unavailable', async () => {
    setMatcher({ engine: 'groq', model: 'test', compare: async () => { throw new Error('Groq API 503'); } });
    const { agent, id } = await upload('student');
    const m = (await agent.get(`/api/v1/documents/${id}/profile-match`).expect(200)).body;
    expect(m).toMatchObject({ engine: 'basic', note: expect.stringMatching(/Groq was unavailable \(Groq API 503\)/) });
    expect(m.results[0].outcome).toBe('match');
  });

  it('tells each listed document how it compares with the profile', async () => {
    const { agent, id } = await upload('student2'); // someone else's card: differs
    const listed = (await agent.get('/api/v1/documents').expect(200)).body.find((d: { id: string }) => d.id === id);
    expect(listed.profileMatch).toBe('mismatch');
    expect((await agent.get(`/api/v1/documents/${id}`).expect(200)).body.profileMatch).toBe('mismatch');
    const { agent: own, id: ownId } = await upload('student');
    expect((await own.get(`/api/v1/documents/${ownId}`).expect(200)).body.profileMatch).toBe('match');
  });

  it('keeps another student from reading the match', async () => {
    const { id } = await upload('student');
    await (await h.login('student2')).get(`/api/v1/documents/${id}/profile-match`).expect(404);
  });
});

describe('virus scan result', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    h.ocr.results.set('scanok', fakeOcr(IDENTITY));
  });
  afterAll(() => h.stop());

  it('reports a clean scan on upload and keeps it with the document', async () => {
    const student = await h.login('student');
    const res = await student.post('/api/v1/documents').attach('file', png('scanok'), 'card.png').expect(202);
    expect(res.body).toMatchObject({ originalName: 'card.png', scan: { clean: true, engine: 'signature' } });
    const listed = (await student.get('/api/v1/documents').expect(200)).body.find((d: { id: string }) => d.id === res.body.id);
    expect(listed.scan).toMatchObject({ clean: true, engine: 'signature' });
  });

  it('names the virus and stores nothing when one is found', async () => {
    const student = await h.login('student');
    const before = await DocumentModel.countDocuments();
    const eicar = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`)]);
    const res = await student.post('/api/v1/documents').attach('file', eicar, 'bad.pdf').expect(422);
    expect(res.body.error).toMatchObject({ code: 'malware_detected', details: { signature: 'EICAR-Test-Signature' } });
    expect(res.body.error.message).toBe('Virus found in "bad.pdf" (EICAR-Test-Signature). The file was not stored.');
    expect(await DocumentModel.countDocuments()).toBe(before);
  });
});
