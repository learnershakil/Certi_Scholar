import { Queue, UnrecoverableError, Worker, type ConnectionOptions } from 'bullmq';
import { config } from '../config.js';
import { logger } from '../lib/events.js';

/**
 * Job names map onto separate queues so slow OCR never delays analysis, verification or rule evaluation.
 * Every handler is idempotent: a retried or duplicated job converges to the same state.
 */
export const JOB_QUEUES = {
  'document.ocr': 'ocr',
  'document.analyse': 'analysis',
  'document.profile-match': 'analysis',
  'document.verify': 'verification',
  'application.evaluate': 'evaluation',
  'maintenance.retention': 'maintenance',
} as const;
export type JobName = keyof typeof JOB_QUEUES;

export interface JobContext {
  attempt: number;
  finalAttempt: boolean;
}
export type JobHandler = (data: Record<string, string>, ctx: JobContext) => Promise<void>;

/** Thrown for failures that a retry cannot fix (e.g. an unreadable file). */
export class PermanentJobError extends Error {}

export interface JobQueue {
  add(name: JobName, data: Record<string, string>, opts?: { jobId?: string }): Promise<void>;
  close(): Promise<void>;
}


export class BullMqQueue implements JobQueue {
  private queues = new Map<string, Queue>();
  constructor(private readonly connection: ConnectionOptions) {}

  async add(name: JobName, data: Record<string, string>, opts: { jobId?: string } = {}) {
    const qName = JOB_QUEUES[name];
    let q = this.queues.get(qName);
    if (!q) this.queues.set(qName, (q = new Queue(qName, { connection: this.connection })));
    await q.add(name, data, {
      // BullMQ reserves ':' in custom ids; keep callers' readable ids but make them safe.
      jobId: opts.jobId?.replace(/:/g, '-'),
      attempts: config().JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: config().JOB_BACKOFF_MS },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: { age: 7 * 86_400 },
    });
  }

  async close() {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

/** Runs jobs on the event loop after the request returns. Test/dev only — refused by config in production. */
export class InlineQueue implements JobQueue {
  private pending = new Set<Promise<void>>();
  constructor(private readonly handlers: Partial<Record<JobName, JobHandler>>) {}

  async add(name: JobName, data: Record<string, string>) {
    const run = (async () => {
      await new Promise((r) => setImmediate(r));
      const attempts = config().JOB_ATTEMPTS;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          await this.handlers[name]?.(data, { attempt, finalAttempt: attempt === attempts });
          return;
        } catch (err) {
          if (err instanceof PermanentJobError || attempt === attempts) {
            logger.warn({ name, err: (err as Error).message }, 'inline job failed');
            return;
          }
        }
      }
    })();
    this.pending.add(run);
    run.finally(() => this.pending.delete(run));
  }

  /** Waits until every job, including jobs enqueued by jobs, has settled. */
  async drain() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  async close() {
    await this.drain();
  }
}

export function redisConnection(): ConnectionOptions {
  const url = new URL(config().REDIS_URL);
  return { host: url.hostname, port: Number(url.port || 6379), password: url.password || undefined, maxRetriesPerRequest: null };
}

export function startWorkers(handlers: Record<JobName, JobHandler>, queues: string[] = Object.values(JOB_QUEUES)) {
  const c = config();
  const concurrency: Record<string, number> = { ocr: c.OCR_CONCURRENCY, maintenance: 1 };
  return [...new Set(queues)].map((qName) => {
    const worker = new Worker(
      qName,
      async (job) => {
        const attempt = job.attemptsMade + 1;
        try {
          await handlers[job.name as JobName](job.data, { attempt, finalAttempt: attempt >= (job.opts.attempts ?? 1) });
        } catch (err) {
          if (err instanceof PermanentJobError) throw new UnrecoverableError(err.message);
          throw err;
        }
      },
      { connection: redisConnection(), concurrency: concurrency[qName] ?? c.WORKER_CONCURRENCY },
    );
    worker.on('failed', (job, err) => logger.warn({ queue: qName, job: job?.name, id: job?.id, err: err.message }, 'job failed'));
    return worker;
  });
}

let queue: JobQueue | undefined;
export const jobQueue = (): JobQueue => {
  if (!queue) throw new Error('Job queue not initialised');
  return queue;
};
export const setJobQueue = (q: JobQueue) => (queue = q);
