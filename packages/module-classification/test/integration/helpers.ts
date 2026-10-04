import mongoose from "mongoose";
import { Redis } from "ioredis";
import type { ResultPublisher, TimelineEmitter } from "../../src/adapters.js";
import type { ClassificationCompletedEvent, TimelineEvent } from "../../src/contracts.js";
import { ClassificationModel, DocumentTypeModel } from "../../src/models.js";
import { seedDocumentTypes } from "../../src/seed.js";
import type { DocumentClassifier, DocumentTypeDef, ClassificationResult } from "../../src/types.js";

export const TEST_MONGO_URL =
  process.env["TEST_MONGO_URL"] ?? "mongodb://localhost:27018/certischolar_test";

export function assertTestDbName(mongoUrl: string): void {
  const url = new URL(mongoUrl);
  const dbName = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to connect to non-test database "${dbName}". Database name must end with "_test".`,
    );
  }
}

export const TEST_REDIS = { host: "localhost", port: 6379, db: 15 };

export async function connectTestDb(): Promise<void> {
  assertTestDbName(TEST_MONGO_URL);
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(TEST_MONGO_URL);
  }
}

export async function disconnectTestDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export async function resetDb(): Promise<void> {
  assertTestDbName(TEST_MONGO_URL);
  await ClassificationModel.deleteMany({});
  await DocumentTypeModel.deleteMany({});
  await seedDocumentTypes();
}

export class FakeResultPublisher implements ResultPublisher {
  readonly events: ClassificationCompletedEvent[] = [];

  async publish(event: ClassificationCompletedEvent): Promise<void> {
    this.events.push(event);
  }
}

export class ThrowingResultPublisher implements ResultPublisher {
  async publish(_event: ClassificationCompletedEvent): Promise<void> {
    throw new Error("Publisher failure");
  }
}

export class FakeTimelineEmitter implements TimelineEmitter {
  readonly events: TimelineEvent[] = [];

  async emit(event: TimelineEvent): Promise<void> {
    this.events.push(event);
  }
}

export class ThrowingTimelineEmitter implements TimelineEmitter {
  async emit(_event: TimelineEvent): Promise<void> {
    throw new Error("Timeline failure");
  }
}

export class ThrowingDocumentClassifier implements DocumentClassifier {
  readonly version = "throwing-classifier";

  async classify(
    _input: { text: string },
    _types: DocumentTypeDef[],
  ): Promise<ClassificationResult> {
    throw new Error("Classifier failure");
  }
}

export async function resetRedis(): Promise<void> {
  const redis = new Redis(TEST_REDIS);
  try {
    await redis.flushdb();
  } finally {
    await redis.quit();
  }
}
