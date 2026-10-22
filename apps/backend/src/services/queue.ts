// --------------- VAIBHAV TYAGI WORK ----------------
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

export const documentScanQueue = new Queue('document-scan', { connection });
export const ocrHandoffQueue = new Queue('m2-ocr', { connection });

// Fallback for local testing without Redis
let redisConnected = true;
connection.on('error', () => {
  if (redisConnected) {
    console.warn('[Queue] Redis unavailable. Switching to inline fallback processing for local development.');
    redisConnected = false;
  }
});

const originalAdd = documentScanQueue.add.bind(documentScanQueue);
documentScanQueue.add = async (name: string, data: any, opts: any): Promise<any> => {
  if (!redisConnected && process.env.NODE_ENV !== 'production') {
    // Process inline for seamless local UI testing without Redis
    console.log(`[Queue Fallback] Processing job ${name} inline...`);
    setTimeout(async () => {
      try {
        const { DocumentModel } = await import('../models/Document');
        const doc = await DocumentModel.findOne({ documentId: data.documentId });
        if (doc) {
          doc.status = 'scanning';
          await doc.save();
          
          await new Promise(r => setTimeout(r, 2000)); // Simulate scan delay
          
          const { getStorageProvider } = await import('./storage');
          const storage = getStorageProvider();
          await storage.upload(doc.storageKey, data.filePath, data.mimeType);
          
          const fs = await import('fs');
          if (fs.existsSync(data.filePath)) {
            fs.unlinkSync(data.filePath);
          }
          
          doc.status = 'clean';
          await doc.save();
          console.log(`[Queue Fallback] Document ${data.documentId} marked as clean.`);
        }
      } catch (e) {
        console.error('[Queue Fallback] Error processing job:', e);
      }
    }, 1000);
    return { id: 'local-job-' + Date.now() };
  }
  return originalAdd(name, data, opts);
};
