import { Worker, UnrecoverableError, type ConnectionOptions } from "bullmq";
import { OcrCompletedEvent } from "./contracts.js";
import { QUEUES } from "./queues.js";
import type { ClassificationService } from "./service.js";

/** Consumes the `classification` queue that M2 pushes to when OCR finishes. */
export function startClassificationWorker(opts: {
  service: ClassificationService;
  connection: ConnectionOptions;
  concurrency?: number;
}) {
  const worker = new Worker(
    QUEUES.CLASSIFICATION,
    async (job) => {
      const parsed = OcrCompletedEvent.safeParse(job.data);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        throw new UnrecoverableError(`Invalid OcrCompletedEvent: ${detail}`);
      }
      return opts.service.run(parsed.data, {
        actor: { type: "system", id: "classification-worker" },
      });
    },
    { connection: opts.connection, concurrency: opts.concurrency ?? 4 },
  );

  worker.on("failed", (job, err) =>
    console.error(`[classification] job ${job?.id} failed: ${err.message}`),
  );
  return worker;
}
