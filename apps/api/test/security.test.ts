import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt, hashPassword, signAccessToken, verifyAccessToken, verifyPassword } from '../src/lib/crypto.js';
import { EncryptedFileStore } from '../src/lib/storage.js';
import { hasActivePdfContent, sniffMime } from '../src/lib/fileType.js';
import { SignatureScanner } from '../src/lib/scanner.js';
import { loadConfig, resetConfig } from '../src/config.js';
import { authenticityStatement, resolveProvider, SimulatedProvider, statusFor } from '../src/verification/providers.js';

const key = randomBytes(32);

describe('encryption at rest', () => {
  it('round-trips and rejects tampering', () => {
    const blob = encrypt(Buffer.from('income: 240000'), key, 'k1');
    expect(decrypt(blob, { k1: key }).toString()).toBe('income: 240000');
    blob[blob.length - 1] ^= 1;
    expect(() => decrypt(blob, { k1: key })).toThrow();
  });

  it('refuses an unknown key id', () => {
    expect(() => decrypt(encrypt(Buffer.from('x'), key, 'k1'), { k2: key })).toThrow(/Unknown storage key/);
  });

  it('stores no plaintext on disk and validates storage keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-store-'));
    const store = new EncryptedFileStore(dir, { k1: key }, 'k1');
    const id = await store.put(Buffer.from('ANANYA SHARMA 2345 6789 0124'));
    const [sub] = await readdir(dir);
    const raw = await readFile(join(dir, sub, id));
    expect(raw.toString('latin1')).not.toContain('ANANYA');
    expect((await store.get(id)).toString()).toContain('ANANYA');
    await expect(store.get('../../etc/passwd')).rejects.toThrow(/Invalid storage key/);
    await store.remove(id);
    await expect(store.get(id)).rejects.toThrow();
  });
});

describe('passwords and pre-signed links', () => {
  it('hashes passwords with a salt', () => {
    const h = hashPassword('correct horse');
    expect(h).not.toBe(hashPassword('correct horse'));
    expect(verifyPassword('correct horse', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
    expect(verifyPassword('x', 'garbage')).toBe(false);
  });

  it('accepts a valid token and rejects expired or forged ones', () => {
    const secret = 's'.repeat(32);
    const claims = { documentId: 'd', variant: 'preview' as const, userId: 'u', exp: Math.floor(Date.now() / 1000) + 60 };
    const token = signAccessToken(claims, secret);
    expect(verifyAccessToken(token, secret)).toMatchObject({ documentId: 'd' });
    expect(verifyAccessToken(token, secret, Date.now() + 61_000)).toBeNull();
    expect(verifyAccessToken(token, 'x'.repeat(32))).toBeNull();
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, documentId: 'other' })).toString('base64url');
    expect(verifyAccessToken(`${forged}.${sig}`, secret)).toBeNull();
    expect(verifyAccessToken('nonsense', secret)).toBeNull();
  });
});

describe('upload content validation', () => {
  it('sniffs the real type from magic bytes', () => {
    expect(sniffMime(Buffer.from('%PDF-1.7 ....'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffMime(Buffer.from('MZ executable....'))).toBeNull();
    expect(sniffMime(Buffer.from('tiny'))).toBeNull();
  });

  it('detects active PDF content', () => {
    expect(hasActivePdfContent(Buffer.from('%PDF-1.7 /OpenAction << /JS (app.alert(1)) >>'))).toBe(true);
    expect(hasActivePdfContent(Buffer.from('%PDF-1.7 /Type /Page'))).toBe(false);
  });

  it('detects the EICAR test signature', async () => {
    const eicar = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`;
    expect(await new SignatureScanner().scan(Buffer.from(eicar))).toMatchObject({ clean: false });
    expect(await new SignatureScanner().scan(Buffer.from('fine'))).toMatchObject({ clean: true });
  });
});

describe('production configuration guards', () => {
  const base = { JWT_SECRET: 'j'.repeat(32), PRESIGN_SECRET: 'p'.repeat(32), STORAGE_KEY: key.toString('base64') };
  afterEach(() => {
    Object.assign(process.env, { NODE_ENV: 'test', QUEUE_DRIVER: 'inline', MALWARE_SCANNER: 'signature' });
    resetConfig();
  });

  it('refuses the inline queue and the signature scanner in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', QUEUE_DRIVER: 'inline' })).toThrow(/QUEUE_DRIVER/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', MALWARE_SCANNER: 'signature' })).toThrow(/MALWARE_SCANNER/);
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).QUEUE_DRIVER).toBe('bullmq');
  });

  it('rejects a malformed storage key and short secrets', () => {
    expect(() => loadConfig({ ...base, STORAGE_KEY: 'short' })).toThrow(/STORAGE_KEY/);
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('blocks the simulated verification provider in production', () => {
    Object.assign(process.env, { NODE_ENV: 'production', QUEUE_DRIVER: 'bullmq', MALWARE_SCANNER: 'clamav' });
    resetConfig();
    expect(() => resolveProvider({ verificationProvider: 'simulated' })).toThrow(/cannot be used in production/);
  });

  it('requires credentials for the registry provider', () => {
    resetConfig();
    expect(() => resolveProvider({ verificationProvider: 'registry' })).toThrow(/base URL/);
    expect(resolveProvider({ verificationProvider: 'manual_only' })).toBeNull();
  });
});

describe('verification labelling', () => {
  it('labels the simulated provider unmistakably', async () => {
    const p = new SimulatedProvider();
    expect(p.simulated).toBe(true);
    expect(p.label).toMatch(/^SIMULATED/);
    expect(await p.verify({ documentType: 'marksheet', fields: { roll_number: '1' } })).toMatchObject({ outcome: 'match' });
    expect(await p.verify({ documentType: 'marksheet', fields: {} })).toMatchObject({ outcome: 'not_found' });
  });

  it('never states authenticity for a simulated or missing check', () => {
    expect(statusFor('match', 'simulated')).toBe('simulated_match');
    expect(authenticityStatement('simulated_match')).toMatchObject({ established: false, text: expect.stringMatching(/NOT been established/) });
    expect(authenticityStatement('not_verified').established).toBe(false);
    expect(authenticityStatement(statusFor('match', 'authority')).established).toBe(true);
    expect(authenticityStatement(statusFor('not_found', 'authority')).established).toBe(false);
  });
});
