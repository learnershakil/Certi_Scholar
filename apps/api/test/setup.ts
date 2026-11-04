import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-chars',
  PRESIGN_SECRET: 'test-presign-secret-at-least-32-characters',
  STORAGE_KEY: randomBytes(32).toString('base64'),
  STORAGE_DIR: join(tmpdir(), `certischolar-test-${process.pid}`),
  QUEUE_DRIVER: 'inline',
  MALWARE_SCANNER: 'signature',
  MAX_UPLOAD_BYTES: String(2 * 1024 * 1024),
  SEED_DEMO: 'true',
  SEED_DEMO_PASSWORD: 'test-demo-password-2026',
});
// Keeps the mongod binary on a short path (Windows MAX_PATH).
process.env.MONGOMS_DOWNLOAD_DIR ??= join(homedir(), '.cache', 'mongodb-binaries');
