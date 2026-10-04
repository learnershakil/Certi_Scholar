import fs from "node:fs";
import type { Job } from "bullmq";
import { createRedis } from "../queues.js";
import {
  CLASSIFICATION_JOB_OPTIONS,
  createClassificationQueue,
  enqueueOcrCompleted,
} from "../producer.js";

const args = process.argv.slice(2);
let documentId: string | undefined;
let filePath: string | undefined;
let rawJson: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--id" && i + 1 < args.length) {
    documentId = args[++i];
  } else if (args[i] === "--file" && i + 1 < args.length) {
    filePath = args[++i];
  } else if (args[i] === "--raw" && i + 1 < args.length) {
    rawJson = args[++i];
  }
}

if (!documentId) {
  console.error("Missing required argument: --id <documentId>");
  process.exit(1);
}

const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const connection = createRedis(redisUrl);
const queue = createClassificationQueue(connection);

let job: Job;
if (rawJson !== undefined) {
  const jobData: unknown = JSON.parse(rawJson);
  job = await queue.add("ocr-completed", jobData, CLASSIFICATION_JOB_OPTIONS);
} else if (filePath !== undefined) {
  const text = fs.readFileSync(filePath, "utf-8");
  job = await enqueueOcrCompleted(queue, { version: "1", documentId, text });
} else {
  console.error("Must provide either --file <path> or --raw '<json>'");
  process.exit(1);
}

console.log(`Enqueued job ${job.id}`);

await queue.close();
await connection.quit();
