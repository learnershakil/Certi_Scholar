import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config, type Config } from '../config.js';
import { decrypt, encrypt } from './crypto.js';

/**
 * Document storage. Callers only see opaque random keys (stored on the Document in MongoDB).
 * Every file is encrypted by the application (AES-256-GCM) before it reaches a backend, so a backend —
 * a private volume or a Cloudflare R2 bucket — only ever holds ciphertext.
 */
export interface BlobStore {
  put(data: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  health(): Promise<{ ok: boolean; driver: string; detail?: string }>;
}

/** Where encrypted bytes live. Reads and writes raw (already encrypted) bytes. */
export interface ObjectBackend {
  readonly driver: string;
  write(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  check(): Promise<void>;
}

const KEY_PATTERN = /^[a-f0-9-]{36}$/;
const assertKey = (key: string) => {
  if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage key');
};

/** A private directory (a Docker volume), never under a web root. */
export class FileBackend implements ObjectBackend {
  readonly driver = 'file';
  constructor(private readonly dir: string) {}

  private path(key: string) {
    assertKey(key);
    return join(this.dir, key.slice(0, 2), key);
  }
  async write(key: string, bytes: Buffer) {
    await mkdir(join(this.dir, key.slice(0, 2)), { recursive: true });
    await writeFile(this.path(key), bytes, { mode: 0o600 });
  }
  async read(key: string) {
    return readFile(this.path(key));
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
  async exists(key: string) {
    return stat(this.path(key)).then(() => true, () => false);
  }
  async check() {
    await mkdir(this.dir, { recursive: true });
  }
}

/** Cloudflare R2 through its S3-compatible API. The bucket stays private; files are never served from it directly. */
export class R2Backend implements ObjectBackend {
  readonly driver = 'r2';
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly prefix = 'documents/',
  ) {}

  private objectKey(key: string) {
    assertKey(key);
    return `${this.prefix}${key}`;
  }
  async write(key: string, bytes: Buffer) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), Body: bytes, ContentType: 'application/octet-stream' }));
  }
  async read(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
  }
  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
      return true;
    } catch (err) {
      if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  }
  async check() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

export class EncryptedStore implements BlobStore {
  constructor(
    readonly backend: ObjectBackend,
    private readonly keys: Record<string, Buffer>,
    private readonly activeKeyId: string,
  ) {}

  async put(data: Buffer) {
    const key = randomUUID();
    await this.backend.write(key, encrypt(data, this.keys[this.activeKeyId], this.activeKeyId));
    return key;
  }
  async get(key: string) {
    return decrypt(await this.backend.read(key), this.keys);
  }
  async remove(key: string) {
    await this.backend.delete(key);
  }
  async health() {
    try {
      await this.backend.check();
      return { ok: true, driver: this.backend.driver };
    } catch (err) {
      return { ok: false, driver: this.backend.driver, detail: (err as Error).message };
    }
  }
}

/** Kept for the file-volume case and existing callers. */
export class EncryptedFileStore extends EncryptedStore {
  constructor(dir: string, keys: Record<string, Buffer>, activeKeyId: string) {
    super(new FileBackend(dir), keys, activeKeyId);
  }
}

export function r2Client(c: Config) {
  return new S3Client({
    region: c.R2_REGION,
    endpoint: c.R2_ENDPOINT ?? `https://${c.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: c.R2_ACCESS_KEY_ID!, secretAccessKey: c.R2_SECRET_ACCESS_KEY! },
  });
}

export function backendFor(c: Config, driver = c.STORAGE_DRIVER): ObjectBackend {
  return driver === 'r2' ? new R2Backend(r2Client(c), c.R2_BUCKET_NAME!, c.R2_KEY_PREFIX) : new FileBackend(resolve(c.STORAGE_DIR));
}

let store: BlobStore | undefined;
export function blobStore(): BlobStore {
  if (!store) {
    const c = config();
    store = new EncryptedStore(backendFor(c), { [c.STORAGE_KEY_ID]: Buffer.from(c.STORAGE_KEY, 'base64') }, c.STORAGE_KEY_ID);
  }
  return store;
}
export const setBlobStore = (s: BlobStore) => (store = s);
