import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createClassificationRouter } from "../../src/router.js";
import { ClassificationService } from "../../src/service.js";
import { KeywordClassifier } from "../../src/classifier.js";
import { NoOcrTextProvider } from "../../src/adapters.js";
import {
  connectTestDb,
  disconnectTestDb,
  resetDb,
  FakeResultPublisher,
  FakeTimelineEmitter,
} from "./helpers.js";

describe("ClassificationRouter integration", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    await connectTestDb();
    const app = express();
    const service = new ClassificationService({
      classifier: new KeywordClassifier(),
      publisher: new FakeResultPublisher(),
      timeline: new FakeTimelineEmitter(),
    });
    const router = createClassificationRouter({
      service,
      ocrTextProvider: new NoOcrTextProvider(),
    });
    app.use(router);

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://localhost:${addr.port}`;
          resolve();
        } else {
          reject(new Error("Failed to get server address"));
        }
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it("POST /internal/classify with a valid marksheet text: 200, classified", async () => {
    const res = await fetch(`${baseUrl}/internal/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: "1",
        documentId: "router-marksheet-1",
        text: "CENTRAL BOARD OF SECONDARY EDUCATION Statement of Marks Roll No: 123456 Total Marks: 450 Result: PASS Grade: A1",
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("classified");
    expect(data.documentTypeCode).toBe("MARKSHEET");
  });

  it("POST /internal/classify with {}: 400 with error 'validation_error'", async () => {
    const res = await fetch(`${baseUrl}/internal/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("validation_error");
  });

  it("POST /internal/classify with malformed JSON: 400 with error 'invalid_json'", async () => {
    const res = await fetch(`${baseUrl}/internal/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"version": "1", malformed',
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid_json");
  });

  it("GET /documents/none/classification: 404", async () => {
    const res = await fetch(`${baseUrl}/documents/none/classification`);
    expect(res.status).toBe(404);
  });

  it("POST /documents/x/classify with no body and the default NoOcrTextProvider: 422 with error 'no_ocr_text'", async () => {
    const res = await fetch(`${baseUrl}/documents/x/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe("no_ocr_text");
  });

  it("PATCH /documents/d1/classification with an unknown type code: 404", async () => {
    const res = await fetch(`${baseUrl}/documents/d1/classification`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentTypeCode: "UNKNOWN_TYPE_XYZ",
        actorId: "officer-1",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /document-types twice with the same code: 201 then 409", async () => {
    const typePayload = {
      code: "TEST_TYPE_7",
      name: "Test Type 7",
      keywords: [{ term: "test", weight: 1.0 }],
      regexPatterns: [],
      anchorTerms: ["test"],
      excludeTerms: [],
    };

    const res1 = await fetch(`${baseUrl}/document-types`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(typePayload),
    });
    expect(res1.status).toBe(201);

    const res2 = await fetch(`${baseUrl}/document-types`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(typePayload),
    });
    expect(res2.status).toBe(409);
  });

  it("POST /document-types with an invalid regex '([': 400", async () => {
    const badRegexPayload = {
      code: "BAD_REGEX",
      name: "Bad Regex",
      keywords: [{ term: "test", weight: 1.0 }],
      regexPatterns: [{ pattern: "([", weight: 1.0 }],
    };

    const res = await fetch(`${baseUrl}/document-types`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(badRegexPayload),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("validation_error");
  });
});
