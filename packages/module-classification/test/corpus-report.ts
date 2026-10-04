import fs from "node:fs";
import path from "node:path";
import { KeywordClassifier } from "../src/classifier.js";
import { DEFAULT_DOCUMENT_TYPES } from "../src/seed-data.js";

interface ReportRow {
  folder: string;
  filename: string;
  status: string;
  predicted: string;
  confidence: number;
  reason: string;
}

interface CorpusFile {
  folder: string;
  filename: string;
  filePath: string;
  text: string;
}

function loadFiles(): CorpusFile[] {
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

async function main() {
  const classifier = new KeywordClassifier();
  const files = loadFiles();

  const rows: ReportRow[] = [];
  let correctCount = 0;
  let sentToReviewCount = 0;
  let wrongCount = 0;

  for (const file of files) {
    const result = await classifier.classify(
      { text: file.text },
      DEFAULT_DOCUMENT_TYPES,
    );

    const isUnknown = file.folder === "UNKNOWN";
    const predictedCode = result.documentTypeCode ?? "-";
    const reason = result.reason ?? "-";

    if (isUnknown) {
      if (result.status === "needs_review") {
        correctCount++;
      } else {
        wrongCount++;
      }
    } else {
      if (result.status === "classified" && result.documentTypeCode === file.folder) {
        correctCount++;
      } else if (result.status === "needs_review") {
        sentToReviewCount++;
      } else {
        wrongCount++;
      }
    }

    rows.push({
      folder: file.folder,
      filename: file.filename,
      status: result.status,
      predicted: predictedCode,
      confidence: result.confidence,
      reason,
    });
  }

  console.log("\n--- Corpus Classification Report ---\n");
  console.table(rows);

  console.log("\n--- Totals ---");
  console.log(`Total files:    ${files.length}`);
  console.log(`Correct:        ${correctCount}`);
  console.log(`Sent to review: ${sentToReviewCount}`);
  console.log(`Wrong:          ${wrongCount}\n`);
}

main().catch((err: unknown) => {
  console.error("Error generating corpus report:", err);
  process.exit(1);
});
