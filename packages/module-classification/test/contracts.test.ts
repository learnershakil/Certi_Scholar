import { describe, expect, it } from "vitest";
import { DocumentTypeInput, OcrCompletedEvent } from "../src/contracts.js";

describe("contracts", () => {
  it("accepts a valid OcrCompletedEvent", () => {
    expect(OcrCompletedEvent.safeParse({ version: "1", documentId: "d1", text: "hi" }).success).toBe(true);
  });

  it("rejects an unknown contract version", () => {
    expect(OcrCompletedEvent.safeParse({ version: "2", documentId: "d1", text: "hi" }).success).toBe(false);
  });

  it("rejects an invalid regex in a document type", () => {
    const r = DocumentTypeInput.safeParse({
      code: "TEST_DOC",
      name: "Test",
      keywords: [],
      regexPatterns: [{ pattern: "([", weight: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it("applies defaults to a document type", () => {
    const r = DocumentTypeInput.parse({ code: "TEST_DOC", name: "Test", keywords: [] });
    expect(r.minConfidence).toBe(0.4);
    expect(r.active).toBe(true);
    expect(r.extractionProfileId).toBeNull();
  });
});
