import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KeywordClassifier } from "../src/classifier.js";
import { DEFAULT_DOCUMENT_TYPES } from "../src/seed-data.js";
import type { ClassificationResult } from "../src/types.js";

interface CorpusFile {
  folder: string;
  filename: string;
  filePath: string;
  text: string;
}

function loadCorpusFiles(): CorpusFile[] {
  const corpusDirs = [path.resolve(import.meta.dirname, "corpus")];
  const privateDir = path.resolve(import.meta.dirname, "corpus-private");
  if (fs.existsSync(privateDir)) {
    corpusDirs.push(privateDir);
  }

  const files: CorpusFile[] = [];
  const expectedLabels = ["MARKSHEET", "ID_AADHAAR", "INCOME_CERT", "UNKNOWN"];

  for (const baseDir of corpusDirs) {
    for (const label of expectedLabels) {
      const labelDir = path.join(baseDir, label);
      if (!fs.existsSync(labelDir)) continue;

      const entries = fs.readdirSync(labelDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".txt")) {
          const filePath = path.join(labelDir, entry.name);
          const text = fs.readFileSync(filePath, "utf-8");
          files.push({
            folder: label,
            filename: entry.name,
            filePath,
            text,
          });
        }
      }
    }
  }

  return files;
}

describe("Corpus Test Harness", () => {
  it("satisfies hard zero-wrong-type and soft accuracy thresholds", async () => {
    const classifier = new KeywordClassifier();
    const files = loadCorpusFiles();

    expect(files.length).toBeGreaterThan(0);

    let wrongType = 0;
    let correct = 0;
    let labelledTotal = 0;

    const failures: {
      file: string;
      expected: string;
      result: ClassificationResult;
    }[] = [];

    for (const file of files) {
      const result = await classifier.classify(
        { text: file.text },
        DEFAULT_DOCUMENT_TYPES,
      );

      if (file.folder === "UNKNOWN") {
        if (result.status === "classified") {
          wrongType++;
          failures.push({ file: file.filePath, expected: file.folder, result });
        }
      } else {
        labelledTotal++;
        if (result.status === "classified" && result.documentTypeCode === file.folder) {
          correct++;
        } else {
          failures.push({ file: file.filePath, expected: file.folder, result });
          if (result.status === "classified" && result.documentTypeCode !== file.folder) {
            wrongType++;
          }
        }
      }
    }

    const failureDetails = failures
      .map(
        (f) =>
          `[FAIL] ${f.file}\n  Expected: ${f.expected}\n  Status: ${f.result.status}\n  DocumentTypeCode: ${f.result.documentTypeCode}\n  Reason: ${f.result.reason}\n  Confidence: ${f.result.confidence}\n  Candidates: ${JSON.stringify(f.result.candidates)}\n  Evidence: ${JSON.stringify(f.result.evidence)}`,
      )
      .join("\n\n");

    // HARD: wrongType === 0
    expect(
      wrongType,
      `Hard constraint failed: ${wrongType} files misclassified as wrong type.\n\n${failureDetails}`,
    ).toBe(0);

    // SOFT: for labelled folders, correct / total >= 0.9
    const accuracy = labelledTotal > 0 ? correct / labelledTotal : 1;
    expect(
      accuracy,
      `Soft constraint failed: accuracy was ${accuracy.toFixed(3)} (expected >= 0.9).\n\n${failureDetails}`,
    ).toBeGreaterThanOrEqual(0.9);
  });
});
