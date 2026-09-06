import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { config } from '../config.js';
import { decrypt, encrypt } from './crypto.js';

/**
 * Encrypted-at-rest blob storage on a private volume (never under a web root).
 * Swap for an S3 adapter with SSE-KMS in cloud deployments; callers only see opaque keys.
 */
export interface BlobStore {
  put(data: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export class EncryptedFileStore implements BlobStore {
  constructor(
    private readonly dir: string,
    private readonly keys: Record<string, Buffer>,
    private readonly activeKeyId: string,
  ) {}

  private path(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid storage key');
    return join(this.dir, key.slice(0, 2), key);
  }

  async put(data: Buffer) {
    const key = randomUUID();
    await mkdir(join(this.dir, key.slice(0, 2)), { recursive: true });
    await writeFile(this.path(key), encrypt(data, this.keys[this.activeKeyId], this.activeKeyId), { mode: 0o600 });
    return key;
  }

  async get(key: string) {
    return decrypt(await readFile(this.path(key)), this.keys);
  }

  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}

let store: BlobStore | undefined;
export function blobStore(): BlobStore {
  if (!store) {
    const c = config();
    store = new EncryptedFileStore(
      resolve(c.STORAGE_DIR),
      { [c.STORAGE_KEY_ID]: Buffer.from(c.STORAGE_KEY, 'base64') },
      c.STORAGE_KEY_ID,
    );
  }
  return store;
}
