// --------------- VAIBHAV TYAGI WORK ----------------
import fs from 'fs';
import crypto from 'crypto';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf'
];

export async function validateFile(filePath: string, originalName: string, clientMime: string) {
  // 1. Check size (already checked by multer, but let's be safe)
  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    return { valid: false, error: 'File is empty' };
  }

  // 2. Check Magic Bytes
  const fileTypeMod = await new Function("return import('file-type')")();
  const checkMagicBytes = fileTypeMod.fromFile || fileTypeMod.default?.fromFile;
  const fileType = checkMagicBytes ? await checkMagicBytes(filePath) : undefined;
  
  if (!fileType) {
    return { valid: false, error: 'Could not determine file type' };
  }

  if (!ALLOWED_MIME_TYPES.includes(fileType.mime)) {
    return { valid: false, error: `File type ${fileType.mime} not allowed. Supported: JPEG, PNG, PDF` };
  }

  // Calculate Checksum for idempotency
  const hash = crypto.createHash('sha256');
  const fileBuffer = fs.readFileSync(filePath);
  hash.update(fileBuffer);
  const checksum = hash.digest('hex');

  return {
    valid: true,
    mimeType: fileType.mime,
    extension: fileType.ext,
    checksum
  };
}

