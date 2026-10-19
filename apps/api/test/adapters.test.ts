import { createServer as createHttp, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTcp, type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClamAvScanner } from '../src/lib/scanner.js';
import { HttpOcrClient, OcrServiceError } from '../src/ocr/client.js';
import { RegistryProvider } from '../src/verification/providers.js';
import { InlineQueue, PermanentJobError } from '../src/pipeline/queue.js';
import { fakeOcr } from './helpers.js';

const closers: Array<() => void> = [];
afterEach(() => closers.splice(0).forEach((c) => c()));

async function http(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void) {
  const server = createHttp((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => handler(req, res, body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const json = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

describe('ClamAV adapter (clamd INSTREAM)', () => {
  async function clamd(reply: string) {
    const received: Buffer[] = [];
    const server = createTcp((socket) => {
      socket.on('data', (d) => {
        received.push(d);
        // Zero-length chunk terminates the stream.
        if (Buffer.concat(received).subarray(-4).equals(Buffer.alloc(4))) socket.end(reply);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    closers.push(() => server.close());
    return { port: (server.address() as AddressInfo).port, received };
  }

  it('streams the file and reports clean', async () => {
    const { port, received } = await clamd('stream: OK\0');
    expect(await new ClamAvScanner('127.0.0.1', port).scan(Buffer.from('hello'))).toEqual({ clean: true, engine: 'clamav' });
    const sent = Buffer.concat(received);
    expect(sent.subarray(0, 10).toString()).toBe('zINSTREAM\0');
    expect(sent.readUInt32BE(10)).toBe(5);
  });

  it('reports the signature when infected', async () => {
    const { port } = await clamd('stream: Win.Test.EICAR_HDB-1 FOUND\0');
    expect(await new ClamAvScanner('127.0.0.1', port).scan(Buffer.from('x'))).toEqual({ clean: false, signature: 'Win.Test.EICAR_HDB-1', engine: 'clamav' });
  });

  it('fails closed on an unexpected reply or no daemon', async () => {
    const { port } = await clamd('INSTREAM size limit exceeded. ERROR\0');
    await expect(new ClamAvScanner('127.0.0.1', port).scan(Buffer.from('x'))).rejects.toThrow(/Unexpected ClamAV reply/);
    await expect(new ClamAvScanner('127.0.0.1', 1).scan(Buffer.from('x'))).rejects.toThrow();
  });
});

describe('OCR service client (contract v1)', () => {
  it('sends the contract version and validates the response', async () => {
    const url = await http((req, res) => {
      expect(req.headers['x-contract-version']).toBe('1');
      json(res, 200, fakeOcr(['Roll Number: 1']));
    });
    const r = await new HttpOcrClient(url, 5000).recognise(Buffer.from('%PDF-'), 'application/pdf', 'a.pdf');
    expect(r.pages[0].lines[0].text).toBe('Roll Number: 1');
  });

  it.each([
    [503, { error: { code: 'ocr_unavailable', message: 'down', retryable: true } }, true],
    [422, { error: { code: 'unreadable_document', message: 'bad', retryable: false } }, false],
    [500, null, true],
  ])('maps HTTP %i to retryable=%s', async (status, body, retryable) => {
    const url = await http((_req, res) => (body ? json(res, status, body) : res.writeHead(status).end()));
    const err = await new HttpOcrClient(url, 5000).recognise(Buffer.from('x'), 'image/png', 'a.png').catch((e) => e);
    expect(err).toBeInstanceOf(OcrServiceError);
    expect(err.retryable).toBe(retryable);
  });

  it('treats a contract violation and an unreachable service as retryable', async () => {
    const url = await http((_req, res) => json(res, 200, { contractVersion: '2', pages: [] }));
    expect(await new HttpOcrClient(url, 5000).recognise(Buffer.from('x'), 'image/png', 'a').catch((e) => e)).toMatchObject({ retryable: true, message: expect.stringMatching(/contract violation/) });
    expect(await new HttpOcrClient('http://127.0.0.1:1', 2000).recognise(Buffer.from('x'), 'image/png', 'a').catch((e) => e)).toMatchObject({ retryable: true });
  });

  it('times out a hung service', async () => {
    const url = await http(() => undefined);
    expect(await new HttpOcrClient(url, 200).recognise(Buffer.from('x'), 'image/png', 'a').catch((e) => e)).toMatchObject({ retryable: true });
  });

  it('reports health', async () => {
    const url = await http((_req, res) => json(res, 200, { status: 'ok', providers: ['tesseract'] }));
    expect(await new HttpOcrClient(url, 1000).health()).toMatchObject({ ok: true, providers: ['tesseract'] });
    expect(await new HttpOcrClient('http://127.0.0.1:1', 1000).health()).toEqual({ ok: false });
  });
});

describe('authorised registry adapter', () => {
  it('sends the identifier with credentials and maps outcomes', async () => {
    const url = await http((req, res, body) => {
      expect(req.headers.authorization).toBe('Bearer key-123');
      const { identifier } = JSON.parse(body);
      if (identifier === 'missing') return json(res, 404, {});
      if (identifier === 'broken') return json(res, 500, {});
      if (identifier === 'diff') return json(res, 200, { status: 'mismatch', mismatches: [{ field: 'percentage', submitted: '93.4', authority: '88.2' }] });
      json(res, 200, { status: 'match', reference: 'BRD-1' });
    });
    const p = new RegistryProvider(url, 'key-123');
    expect(p.simulated).toBe(false);
    const verify = (roll: string) => p.verify({ documentType: 'marksheet', fields: { roll_number: roll } });
    expect(await verify('2410387')).toEqual({ outcome: 'match', reference: 'BRD-1', mismatches: undefined });
    expect(await verify('missing')).toEqual({ outcome: 'not_found' });
    expect((await verify('diff')).mismatches?.[0]).toMatchObject({ field: 'percentage' });
    await expect(verify('broken')).rejects.toThrow(/500/);
  });
});

describe('inline queue semantics (mirrors BullMQ retry policy)', () => {
  it('retries transient failures and tells the handler which attempt is final', async () => {
    const attempts: Array<[number, boolean]> = [];
    const q = new InlineQueue({
      'document.ocr': async (_d, ctx) => {
        attempts.push([ctx.attempt, ctx.finalAttempt]);
        if (ctx.attempt < 3) throw new Error('transient');
      },
    });
    await q.add('document.ocr', { documentId: 'x' });
    await q.drain();
    expect(attempts).toEqual([[1, false], [2, false], [3, true]]);
  });

  it('does not retry permanent failures', async () => {
    const handler = vi.fn().mockRejectedValue(new PermanentJobError('unreadable'));
    const q = new InlineQueue({ 'document.ocr': handler });
    await q.add('document.ocr', { documentId: 'x' });
    await q.drain();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('drains jobs enqueued by other jobs', async () => {
    const order: string[] = [];
    const q: InlineQueue = new InlineQueue({
      'document.ocr': async () => {
        order.push('ocr');
        await q.add('document.analyse', {});
      },
      'document.analyse': async () => void order.push('analyse'),
    });
    await q.add('document.ocr', {});
    await q.drain();
    expect(order).toEqual(['ocr', 'analyse']);
  });
});
