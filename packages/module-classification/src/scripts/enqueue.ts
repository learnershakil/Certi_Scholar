import fs from "node:fs";
import { Queue } from "bullmq";
import { createRedis, QUEUES } from "../queues.js";

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

let jobData: unknown;
if (rawJson !== undefined) {
  jobData = JSON.parse(rawJson);
} else if (filePath !== undefined) {
  const text = fs.readFileSync(filePath, "utf-8");
  jobData = { version: "1", documentId, text };
} else {
  console.error("Must provide either --file <path> or --raw '<json>'");
  process.exit(1);
}

const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const connection = createRedis(redisUrl);
const queue = new Queue<unknown>(QUEUES.CLASSIFICATION, { connection });

const job = await queue.add("ocr-completed", jobData, {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: true,
  removeOnFail: false,
});

console.log(`Enqueued job ${job.id}`);

await queue.close();
await connection.quit();
