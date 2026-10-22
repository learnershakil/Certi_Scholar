// --------------- VAIBHAV TYAGI WORK ----------------
import { Job, Queue } from 'bullmq';
import { DocumentModel } from '../models/Document';
import { AuditLogModel } from '../models/AuditLog';
import { getScannerProvider } from '../services/scanner';
import { getStorageProvider } from '../services/storage';
import fs from 'fs';
import path from 'path';
import IORedis from 'ioredis';
import { M1ToM2QueuePayload } from '@certischolar/shared';

const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

const ocrHandoffQueue = new Queue('m2-ocr', { connection });

export async function processScanJob(job: Job) {
  const { documentId, filePath, mimeType } = job.data;

  console.log(`[Worker] Processing scan job for document: ${documentId}`);

  const document = await DocumentModel.findOne({ documentId });
  if (!document) {
    throw new Error(`Document ${documentId} not found`);
  }

  if (document.status !== 'quarantined') {
    console.log(`[Worker] Document ${documentId} is in status ${document.status}, skipping scan.`);
    return;
  }

  // Update status to scanning
  document.status = 'scanning';
  await document.save();

  try {
    const scanner = await getScannerProvider();
    const result = await scanner.scanFile(filePath);

    if (result.error) {
      document.status = 'scan-error';
      document.scanDetails = { error: result.error, timestamp: new Date() };
      await document.save();
      throw new Error(`Scan error: ${result.error}`); // Will trigger BullMQ retry
    }

    if (result.isInfected) {
      document.status = 'infected';
      document.scanDetails = {
        scannerName: 'ClamAV',
        virusName: result.virusName,
        timestamp: new Date()
      };
      await document.save();
      
      await AuditLogModel.create({
        documentId,
        actorId: 'system-scanner',
        action: 'INFECTED',
        metadata: { virusName: result.virusName }
      });

      // Remove from quarantine
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    }

    // Clean
    document.status = 'clean';
    document.scanDetails = {
      scannerName: 'ClamAV',
      timestamp: new Date()
    };
    
    // Move to permanent storage
    const storage = getStorageProvider();
    await storage.upload(document.storageKey, filePath, document.mimeType);
    await document.save();

    await AuditLogModel.create({
      documentId,
      actorId: 'system-scanner',
      action: 'CLEAN',
    });

    // Remove from quarantine
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Handoff to M2
    document.status = 'queued';
    await document.save();

    const payload: M1ToM2QueuePayload = {
      version: "1.0",
      documentId: document.documentId,
      storageKey: document.storageKey,
      requestedType: document.requestedType,
      mimeType: document.mimeType
    };

    await ocrHandoffQueue.add('ocr-process', payload);

    await AuditLogModel.create({
      documentId,
      actorId: 'system-queue',
      action: 'QUEUED_M2',
    });

    console.log(`[Worker] Document ${documentId} scanned and queued successfully.`);

  } catch (error: any) {
    console.error(`[Worker] Error scanning document ${documentId}:`, error);
    // If it's not a handled scan error, we might want to fail it eventually.
    // BullMQ handles retries. If attempts exhausted, it goes to failed/DLQ.
    throw error;
  }
}

