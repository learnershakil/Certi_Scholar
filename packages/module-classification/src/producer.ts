import { Queue, type ConnectionOptions, type JobsOptions, type Job } from "bullmq";
import { OcrCompletedEvent } from "./contracts.js";
import { QUEUES } from "./queues.js";

export const CLASSIFICATION_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: true,
  removeOnFail: false,
};

export function createClassificationQueue(connection: ConnectionOptions): Queue {
  return new Queue(QUEUES.CLASSIFICATION, { connection });
}

export async function enqueueOcrCompleted(
  queue: Queue,
  event: OcrCompletedEvent,
): Promise<Job> {
  const parsed = OcrCompletedEvent.parse(event);
  return queue.add("ocr-completed", parsed, CLASSIFICATION_JOB_OPTIONS);
}
