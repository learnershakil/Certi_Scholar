// --------------- VAIBHAV TYAGI WORK ----------------
import fs from 'fs';
import path from 'path';

export interface StorageProvider {
  upload(key: string, filePath: string, mimeType: string): Promise<string>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  exists(key: string): Promise<boolean>;
}

export class LocalStorageProvider implements StorageProvider {
  public basePath: string;

  constructor() {
    this.basePath = process.env.STORAGE_LOCAL_PATH || path.join(process.cwd(), '../backend/.storage');
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  async upload(key: string, filePath: string, mimeType: string): Promise<string> {
    const dest = path.join(this.basePath, key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(filePath, dest);
    return key;
  }

  async delete(key: string): Promise<void> {
    const dest = path.join(this.basePath, key);
    if (fs.existsSync(dest)) {
      fs.unlinkSync(dest);
    }
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const expires = Date.now() + expiresInSeconds * 1000;
    const dataToSign = `${key}:${expires}`;
    const secret = process.env.JWT_SECRET || 'fallback-secret-key-do-not-use-in-production';
    const crypto = await import('crypto');
    const signature = crypto.createHmac('sha256', secret).update(dataToSign).digest('hex');
    const token = Buffer.from(`${dataToSign}:${signature}`).toString('base64');
    return `${process.env.API_URL || 'http://localhost:3001'}/api/documents/local-access/${token}`;
  }

  async exists(key: string): Promise<boolean> {
    const dest = path.join(this.basePath, key);
    return fs.existsSync(dest);
  }
}

export function getStorageProvider(): StorageProvider {
  const provider = process.env.STORAGE_PROVIDER || 'local';
  if (provider === 'local') {
    return new LocalStorageProvider();
  }
  throw new Error(`Storage provider ${provider} not implemented.`);
}
