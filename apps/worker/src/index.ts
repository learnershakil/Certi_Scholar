// --------------- VAIBHAV TYAGI WORK ----------------
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import { connectDB } from './config/db';
import { processScanJob } from './jobs/scanJob';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

const startWorker = async () => {
  await connectDB();

  // Create quarantine dir just in case
  const quarantinePath = path.resolve(__dirname, '../../../quarantine');
  if (!fs.existsSync(quarantinePath)) {
    fs.mkdirSync(quarantinePath, { recursive: true });
  }

  const worker = new Worker('document-scan', processScanJob, { connection });

  worker.on('completed', job => {
    console.log(`[Worker] Job ${job.id} has completed!`);
  });

  worker.on('failed', (job, err) => {
    console.log(`[Worker] Job ${job?.id} has failed with ${err.message}`);
  });

  console.log('[Worker] Started document-scan worker');
};

startWorker().catch(err => {
  console.error('[Worker] Fatal error', err);
  process.exit(1);
});

