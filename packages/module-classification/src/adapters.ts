/**
 * Everything that touches other modules goes through these small interfaces,
 * so M3 works today over plain HTTP and gets wired to real queues later
 * without changing the service.
 */
import { Queue, type ConnectionOptions } from "bullmq";
import type { ClassificationCompletedEvent, TimelineEvent } from "./contracts.js";
import { QUEUES } from "./queues.js";

// ---------- Where results go (M4 extraction / M5 review) ----------
export interface ResultPublisher {
  publish(event: ClassificationCompletedEvent): Promise<void>;
}

export class LoggerResultPublisher implements ResultPublisher {
  async publish(event: ClassificationCompletedEvent) {
    console.log("[classification] result", JSON.stringify(event));
  }
}

const JOB_OPTS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: true,
  removeOnFail: false,
} as const;

export class BullMqResultPublisher implements ResultPublisher {
  private readonly extraction: Queue;
  private readonly review: Queue;

  constructor(connection: ConnectionOptions) {
    this.extraction = new Queue(QUEUES.EXTRACTION, { connection });
    this.review = new Queue(QUEUES.REVIEW, { connection });
  }

  async publish(event: ClassificationCompletedEvent) {
    const queue = event.status === "classified" ? this.extraction : this.review;
    // Custom jobId dedupes a retry while the earlier job is still queued.
    await queue.add("classification-completed", event, {
      ...JOB_OPTS,
      jobId: `${queue.name}-${event.documentId}`,
    });
  }

  async close() {
    await Promise.all([this.extraction.close(), this.review.close()]);
  }
}

// ---------- Timeline hook (M10) ----------
export interface TimelineEmitter {
  emit(event: TimelineEvent): Promise<void>;
}

export class NoopTimelineEmitter implements TimelineEmitter {
  async emit() {}
}

export class LoggerTimelineEmitter implements TimelineEmitter {
  async emit(event: TimelineEvent) {
    console.log("[timeline]", JSON.stringify(event));
  }
}

export class QueueTimelineEmitter implements TimelineEmitter {
  private readonly queue: Queue;
  constructor(connection: ConnectionOptions) {
    this.queue = new Queue(QUEUES.TIMELINE, { connection });
  }
  async emit(event: TimelineEvent) {
    await this.queue.add("timeline-event", event, { removeOnComplete: true, attempts: 3 });
  }
  async close() {
    await this.queue.close();
  }
}

// ---------- OCR text lookup (M2) ----------
/** Lets POST /documents/:id/classify retry without the caller resending the text. */
export interface OcrTextProvider {
  getText(documentId: string): Promise<string | null>;
}

export class NoOcrTextProvider implements OcrTextProvider {
  async getText() {
    return null;
  }
}
