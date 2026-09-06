import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const ALGO = 'aes-256-gcm';

/** Envelope: [1 byte keyId length][keyId][12 byte IV][16 byte tag][ciphertext] */
export function encrypt(plain: Buffer, key: Buffer, keyId: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const id = Buffer.from(keyId, 'utf8');
  return Buffer.concat([Buffer.from([id.length]), id, iv, cipher.getAuthTag(), body]);
}

export function decrypt(blob: Buffer, keys: Record<string, Buffer>): Buffer {
  const idLen = blob[0];
  const keyId = blob.subarray(1, 1 + idLen).toString('utf8');
  const key = keys[keyId];
  if (!key) throw new Error(`Unknown storage key id ${keyId}`);
  let o = 1 + idLen;
  const iv = blob.subarray(o, (o += 12));
  const tag = blob.subarray(o, (o += 16));
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(o)), decipher.final()]);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

export interface PresignClaims {
  documentId: string;
  variant: 'original' | 'preview';
  userId: string;
  exp: number; // epoch seconds
}

export function signAccessToken(claims: PresignClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyAccessToken(token: string, secret: string, now = Date.now()): PresignClaims | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PresignClaims;
  return claims.exp * 1000 > now ? claims : null;
}
