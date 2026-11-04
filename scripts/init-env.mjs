// Creates .env from .env.example with fresh random secrets. Usage: node scripts/init-env.mjs [--force]
// Refuses to overwrite an existing .env unless --force is given: replacing STORAGE_KEY makes stored documents unreadable.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const target = join(root, '.env');
if (existsSync(target) && !process.argv.includes('--force')) {
  console.error('.env already exists. Re-run with --force to replace it (existing encrypted documents will no longer open).');
  process.exit(1);
}

const secret = () => randomBytes(32).toString('base64url');
const generated = {
  JWT_SECRET: secret(),
  PRESIGN_SECRET: secret(),
  STORAGE_KEY: randomBytes(32).toString('base64'),
  SEED_DEMO_PASSWORD: `Demo-${randomBytes(6).toString('base64url')}`,
};

const lines = readFileSync(join(root, '.env.example'), 'utf8')
  .split(/\r?\n/)
  .map((line) => {
    const key = line.match(/^([A-Z0-9_]+)=/)?.[1];
    return key && key in generated ? line.replace(/^([A-Z0-9_]+)=\S*/, `$1=${generated[key]}`) : line;
  });
writeFileSync(target, lines.join('\n'), { mode: 0o600 });

console.log(`Wrote ${target}`);
console.log(`Demo account password: ${generated.SEED_DEMO_PASSWORD}`);
