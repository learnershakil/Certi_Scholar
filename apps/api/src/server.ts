import mongoose from 'mongoose';
import { config } from './config.js';
import { createApp } from './app.js';
import { logger } from './lib/events.js';
import { BullMqQueue, InlineQueue, redisConnection, setJobQueue } from './pipeline/queue.js';
import { handlers } from './pipeline/handlers.js';

const c = config();
await mongoose.connect(c.MONGO_URL);
// API processes only enqueue; the worker process (src/worker.ts) consumes.
setJobQueue(c.QUEUE_DRIVER === 'bullmq' ? new BullMqQueue(redisConnection()) : new InlineQueue(handlers));
const server = createApp().listen(c.PORT, () => logger.info({ port: c.PORT, queue: c.QUEUE_DRIVER }, 'api listening'));

const shutdown = async () => {
  server.close();
  await mongoose.disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
