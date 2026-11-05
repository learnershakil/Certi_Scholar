import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { config, loadConfig } from '../src/config.js';
import { EncryptedStore, FileBackend, R2Backend, type ObjectBackend } from '../src/lib/storage.js';
import { migrateStorage } from '../src/migrateStorage.js';
import { png, startHarness, type Harness } from './helpers.js';

/** Stands in for R2: records each command and keeps objects in memory. */
function fakeS3() {
  const objects = new Map<string, Buffer>();
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  const send = async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    sent.push({ name: cmd.constructor.name, input: cmd.input });
    const key = cmd.input.Key as string;
    if (cmd instanceof PutObjectCommand) objects.set(key, Buffer.from(cmd.input.Body as Buffer));
    if (cmd instanceof GetObjectCommand) {
      const body = objects.get(key);
      if (!body) throw Object.assign(new Error('NoSuchKey'), { $metadata: { httpStatusCode: 404 } });
      return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
    }
    if (cmd instanceof HeadObjectCommand && !objects.has(key)) throw Object.assign(new Error('NotFound'), { $metadata: { httpStatusCode: 404 } });
    if (cmd instanceof DeleteObjectCommand) objects.delete(key);
    return {};
  };
  return { client: { send } as unknown as S3Client, objects, sent };
}

const key = randomBytes(32);

describe('R2 backend', () => {
  it('stores ciphertext under the documents/ prefix in the private bucket and reads it back', async () => {
    const s3 = fakeS3();
    const store = new EncryptedStore(new R2Backend(s3.client, 'certischolar'), { k1: key }, 'k1');
    const id = await store.put(Buffer.from('ANANYA SHARMA 2345 6789 0124'));

    const put = s3.sent.find((c) => c.name === 'PutObjectCommand')!;
    expect(put.input).toMatchObject({ Bucket: 'certischolar', Key: `documents/${id}`, ContentType: 'application/octet-stream' });
    const stored = s3.objects.get(`documents/${id}`)!;
    expect(stored.toString('latin1')).not.toContain('ANANYA'); // Cloudflare only ever sees ciphertext
    expect((await store.get(id)).toString()).toContain('ANANYA');

    await store.remove(id);
    expect(s3.objects.has(`documents/${id}`)).toBe(false);
  });

  it('answers whether an object exists and rejects malformed keys', async () => {
    const s3 = fakeS3();
    const backend = new R2Backend(s3.client, 'b');
    expect(await backend.exists('11111111-1111-1111-1111-111111111111')).toBe(false);
    await backend.write('11111111-1111-1111-1111-111111111111', Buffer.from('x'));
    expect(await backend.exists('11111111-1111-1111-1111-111111111111')).toBe(true);
    await expect(backend.read('../../secrets')).rejects.toThrow(/Invalid storage key/);
  });

  it('reports a bucket that cannot be reached as unhealthy', async () => {
    const failing = { send: async () => { throw new Error('AccessDenied'); } } as unknown as S3Client;
    expect(await new EncryptedStore(new R2Backend(failing, 'b'), { k1: key }, 'k1').health()).toEqual({ ok: false, driver: 'r2', detail: 'AccessDenied' });
  });
});

describe('storage configuration', () => {
  const base = { JWT_SECRET: 'j'.repeat(32), PRESIGN_SECRET: 'p'.repeat(32), STORAGE_KEY: key.toString('base64') };
  it('defaults to the local volume', () => {
    expect(loadConfig(base).STORAGE_DRIVER).toBe('file');
  });
  it('needs credentials and a bucket for R2', () => {
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 'r2' })).toThrow(/R2_ACCESS_KEY_ID.*R2_SECRET_ACCESS_KEY.*R2_BUCKET_NAME/s);
    expect(loadConfig({ ...base, STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET_NAME: 'b' })).toMatchObject({ R2_REGION: 'auto', R2_KEY_PREFIX: 'documents/' });
  });
});

/** In-memory backend standing in for R2 during migration. */
class MemoryBackend implements ObjectBackend {
  readonly driver = 'memory';
  objects = new Map<string, Buffer>();
  async write(k: string, b: Buffer) { this.objects.set(k, b); }
  async read(k: string) { return this.objects.get(k)!; }
  async delete(k: string) { this.objects.delete(k); }
  async exists(k: string) { return this.objects.has(k); }
  async check() {}
}

describe('migration from the local volume to R2', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.stop());

  it('copies every stored file unchanged, once, and reports files that are missing', async () => {
    h.ocr.results.set('mig', { contractVersion: '1', provider: 'fake', durationMs: 1, pages: [{ index: 0, width: 1, height: 1, lines: [{ text: 'x', words: [{ text: 'x', conf: 1, bbox: [0, 0, 1, 1] }] }] }], preview: null });
    const student = await h.login('student');
    await student.post('/api/v1/documents').attach('file', png('mig'), 'm.png').expect(202);
    await h.queue.drain();

    const local = new FileBackend(resolve(config().STORAGE_DIR));
    const r2 = new MemoryBackend();
    const first = await migrateStorage(local, r2);
    expect(first.copied).toBeGreaterThan(0);
    expect(first.missing).toEqual([]);
    for (const [k, bytes] of r2.objects) expect(bytes.equals(await local.read(k))).toBe(true); // still encrypted, byte for byte

    const second = await migrateStorage(local, r2);
    expect(second).toMatchObject({ copied: 0, alreadyThere: first.copied });

    const [someKey] = r2.objects.keys();
    r2.objects.delete(someKey);
    await local.delete(someKey);
    expect((await migrateStorage(local, r2)).missing).toEqual([someKey]);
  });
});
