import type { ConnectionOptions } from "bullmq";
import {
  BullMqResultPublisher,
  LoggerResultPublisher,
  NoOcrTextProvider,
  NoopTimelineEmitter,
  QueueTimelineEmitter,
  type OcrTextProvider,
  type ResultPublisher,
  type TimelineEmitter,
} from "./adapters.js";
import { KeywordClassifier } from "./classifier.js";
import { createClassificationRouter } from "./router.js";
import { ClassificationService } from "./service.js";
import { startClassificationWorker } from "./worker.js";
import type { DocumentClassifier } from "./types.js";

export interface ClassificationModuleOptions {
  /** Pass a Redis connection to enable real queues; omit to run HTTP-only. */
  connection?: ConnectionOptions;
  classifier?: DocumentClassifier;
  publisher?: ResultPublisher;
  timeline?: TimelineEmitter;
  ocrTextProvider?: OcrTextProvider;
}

/**
 * One call to wire the module into a host app:
 *   const m3 = createClassificationModule({ connection });
 *   app.use(m3.router);
 *   m3.startWorker();
 */
export function createClassificationModule(opts: ClassificationModuleOptions = {}) {
  const service = new ClassificationService({
    classifier: opts.classifier ?? new KeywordClassifier(),
    publisher:
      opts.publisher ??
      (opts.connection ? new BullMqResultPublisher(opts.connection) : new LoggerResultPublisher()),
    timeline:
      opts.timeline ??
      (opts.connection ? new QueueTimelineEmitter(opts.connection) : new NoopTimelineEmitter()),
  });

  return {
    service,
    router: createClassificationRouter({
      service,
      ocrTextProvider: opts.ocrTextProvider ?? new NoOcrTextProvider(),
    }),
    startWorker() {
      if (!opts.connection) throw new Error("startWorker() needs a Redis connection");
      return startClassificationWorker({ service, connection: opts.connection });
    },
  };
}
