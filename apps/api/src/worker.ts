import mongoose from 'mongoose';
import { Queue } from 'bullmq';
import { config } from './config.js';
import { logger } from './lib/events.js';
import { BullMqQueue, redisConnection, setJobQueue, startWorkers } from './pipeline/queue.js';
import { handlers } from './pipeline/handlers.js';

const c = config();
await mongoose.connect(c.MONGO_URL);
setJobQueue(new BullMqQueue(redisConnection()));

// WORKER_QUEUES lets OCR workers scale independently: e.g. WORKER_QUEUES=ocr
const queues = process.env.WORKER_QUEUES?.split(',').map((q) => q.trim());
const workers = startWorkers(handlers, queues);

// Daily retention sweep (repeatable job, deduplicated by BullMQ).
await new Queue('maintenance', { connection: redisConnection() }).upsertJobScheduler('retention', { pattern: c.RETENTION_CRON }, { name: 'maintenance.retention', data: {} });
logger.info({ queues: queues ?? 'all' }, 'workers started');

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  await mongoose.disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
