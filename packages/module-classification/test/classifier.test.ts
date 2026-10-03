import { describe, expect, it } from "vitest";
import { KeywordClassifier } from "../src/classifier.js";
import { DEFAULT_DOCUMENT_TYPES } from "../src/seed-data.js";
import type { DocumentTypeDef } from "../src/types.js";
import {
  AADHAAR_TEXT,
  AMBIGUOUS_TEXT,
  GIBBERISH_TEXT,
  INCOME_TEXT,
  MARKSHEET_TEXT,
  NOISY_MARKSHEET_TEXT,
} from "./fixtures.js";

const classifier = new KeywordClassifier();
const run = (text: string, types: DocumentTypeDef[] = DEFAULT_DOCUMENT_TYPES) =>
  classifier.classify({ text }, types);

describe("KeywordClassifier", () => {
  it("classifies a marksheet", async () => {
    const r = await run(MARKSHEET_TEXT);
    expect(r.status).toBe("classified");
    expect(r.documentTypeCode).toBe("MARKSHEET");
    expect(r.evidence).toContain("marks obtained");
    expect(r.reason).toBeNull();
  });

  it("classifies an Aadhaar card, using the 12-digit regex", async () => {
    const r = await run(AADHAAR_TEXT);
    expect(r.documentTypeCode).toBe("ID_AADHAAR");
    expect(r.evidence.some((e) => e.startsWith("/"))).toBe(true);
  });

  it("classifies an income certificate", async () => {
    const r = await run(INCOME_TEXT);
    expect(r.documentTypeCode).toBe("INCOME_CERT");
  });

  it("tolerates noisy case and whitespace", async () => {
    const r = await run(NOISY_MARKSHEET_TEXT);
    expect(r.documentTypeCode).toBe("MARKSHEET");
  });

  it("routes gibberish to review and never guesses", async () => {
    const r = await run(GIBBERISH_TEXT);
    expect(r.status).toBe("needs_review");
    expect(r.documentTypeCode).toBeNull();
    expect(r.extractionProfileId).toBeNull();
    expect(r.reason).toBe("low_confidence");
  });

  it("routes an ambiguous document to review", async () => {
    const r = await run(AMBIGUOUS_TEXT);
    expect(r.status).toBe("needs_review");
    expect(r.documentTypeCode).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(1);
  });

  it("routes to review when two types score high but too close (margin rule)", async () => {
    const mk = (code: string, terms: string[]): DocumentTypeDef => ({
      code,
      name: code,
      keywords: terms.map((term) => ({ term, weight: 1 })),
      regexPatterns: [],
      minConfidence: 0.5,
      extractionProfileId: null,
      active: true,
    });
    const types = [mk("A", ["alpha", "beta", "gamma"]), mk("B", ["alpha", "beta", "delta"])];
    const r = await run("alpha beta gamma delta", types);
    expect(r.status).toBe("needs_review");
    expect(r.reason).toBe("ambiguous");
    expect(r.documentTypeCode).toBeNull();
  });

  it("routes empty text to review", async () => {
    const r = await run("   \n  ");
    expect(r.status).toBe("needs_review");
    expect(r.reason).toBe("empty_text");
  });

  it("routes to review when there are no active types", async () => {
    const r = await run(MARKSHEET_TEXT, []);
    expect(r.reason).toBe("no_document_types");
  });

  it("ignores inactive types", async () => {
    const types = DEFAULT_DOCUMENT_TYPES.map((t) =>
      t.code === "MARKSHEET" ? { ...t, active: false } : t,
    );
    const r = await run(MARKSHEET_TEXT, types);
    expect(r.documentTypeCode).not.toBe("MARKSHEET");
  });

  it("does not crash on an invalid admin regex", async () => {
    const types: DocumentTypeDef[] = [
      {
        code: "X",
        name: "X",
        keywords: [{ term: "hello", weight: 1 }],
        regexPatterns: [{ pattern: "([", weight: 1 }],
        minConfidence: 0.3,
        extractionProfileId: null,
        active: true,
      },
    ];
    const r = await run("hello world", types);
    expect(r.documentTypeCode).toBe("X");
  });

  it("passes through the extraction profile of the winning type", async () => {
    const types = DEFAULT_DOCUMENT_TYPES.map((t) =>
      t.code === "MARKSHEET" ? { ...t, extractionProfileId: "profile-1" } : t,
    );
    const r = await run(MARKSHEET_TEXT, types);
    expect(r.extractionProfileId).toBe("profile-1");
  });

  it("returns at most three candidates, best first", async () => {
    const r = await run(MARKSHEET_TEXT);
    expect(r.candidates.length).toBeLessThanOrEqual(3);
    expect(r.candidates[0]?.code).toBe("MARKSHEET");
  });
});
