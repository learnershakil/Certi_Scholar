import mongoose from 'mongoose';
import { config } from './config.js';
import { logger } from './lib/events.js';
import { backendFor, type ObjectBackend } from './lib/storage.js';
import { DocumentModel } from './models/document.js';

/**
 * Copies every stored document file from the local volume to Cloudflare R2 under the same key.
 * Files are copied as stored (already encrypted), so they are never decrypted on the way. Safe to run
 * more than once: files already in R2 are skipped. Run before setting STORAGE_DRIVER=r2:
 *   docker compose run --rm api node dist/migrateStorage.js
 */
export async function migrateStorage(from: ObjectBackend, to: ObjectBackend) {
  const docs = await DocumentModel.find({ $or: [{ storageKey: { $ne: null } }, { previewKey: { $ne: null } }] }).select('storageKey previewKey').lean();
  const keys = docs.flatMap((d) => [d.storageKey, d.previewKey]).filter((k): k is string => Boolean(k));
  const result = { total: keys.length, copied: 0, alreadyThere: 0, missing: [] as string[] };
  for (const key of keys) {
    if (await to.exists(key)) {
      result.alreadyThere++;
      continue;
    }
    if (!(await from.exists(key))) {
      result.missing.push(key);
      continue;
    }
    const bytes = await from.read(key);
    await to.write(key, bytes);
    const back = await to.read(key);
    if (!back.equals(bytes)) throw new Error(`Copy of ${key} does not match the original`);
    result.copied++;
  }
  return result;
}

if (process.argv[1]?.endsWith('migrateStorage.js')) {
  const c = config();
  await mongoose.connect(c.MONGO_URL);
  const result = await migrateStorage(backendFor(c, 'file'), backendFor(c, 'r2'));
  logger.info(result, 'storage migration finished');
  console.log(JSON.stringify(result));
  await mongoose.disconnect();
  process.exit(result.missing.length ? 1 : 0);
}
