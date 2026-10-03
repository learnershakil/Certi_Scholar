import express from "express";
import mongoose from "mongoose";
import { createClassificationModule } from "./module.js";
import { createRedis } from "./queues.js";
import { seedDocumentTypes } from "./seed.js";

const port = Number(process.env["PORT"] ?? 4003);
const mongoUrl = process.env["MONGO_URL"] ?? "mongodb://localhost:27017/certischolar";
const redisUrl = process.env["REDIS_URL"];

await mongoose.connect(mongoUrl);
if (process.env["SEED"] === "1") {
  console.log(`Seeded ${await seedDocumentTypes()} new document type(s).`);
}

const connection = redisUrl ? createRedis(redisUrl) : undefined;
const m3 = createClassificationModule(connection ? { connection } : {});

const app = express();
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});
app.use(m3.router);
if (connection) m3.startWorker();

app.listen(port, () => console.log(`M3 classification listening on :${port}`));
