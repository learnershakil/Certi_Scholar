import type {
  ClassificationResult,
  DocumentClassifier,
  DocumentTypeDef,
  ReviewReason,
} from "./types.js";

const round = (n: number) => Math.round(n * 1000) / 1000;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whole-word / whole-phrase match on already lower-cased, whitespace-normalised text.
 * "vid" must not match inside "provide"; "board" must not match inside "dashboard".
 */
function containsTerm(lowerText: string, term: string): boolean {
  const cleaned = term.toLowerCase().trim().replace(/\s+/g, " ");
  if (cleaned.length === 0) return false;
  const body = escapeRegex(cleaned).replace(/ /g, "\\s+");
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`).test(lowerText);
}

/**
 * Weighted keyword + regex classifier.
 *
 * score(type) = (sum of matched weights) / (sum of ALL weights for that type)
 *
 * A document is only auto-classified when ALL of these hold for the best type:
 *   1. none of its excludeTerms appear,
 *   2. at least one of its anchorTerms appears (when anchors are defined),
 *   3. its score reaches that type's minConfidence,
 *   4. it leads the runner-up by at least `minMargin`.
 * Otherwise the document is routed to human review. It never guesses.
 */
export class KeywordClassifier implements DocumentClassifier {
  readonly version = "keyword-v2";
  private readonly minMargin: number;

  constructor(minMargin = 0.1) {
    this.minMargin = minMargin;
  }

  async classify(
    input: { text: string },
    types: DocumentTypeDef[],
  ): Promise<ClassificationResult> {
    const active = types.filter((t) => t.active);
    const review = (reason: ReviewReason): ClassificationResult => ({
      status: "needs_review",
      documentTypeCode: null,
      extractionProfileId: null,
      confidence: 0,
      candidates: [],
      evidence: [],
      reason,
    });

    if (active.length === 0) return review("no_document_types");

    // OCR output is noisy about whitespace and case; normalise both.
    const normalised = input.text.replace(/\s+/g, " ").trim();
    if (normalised.length === 0) return review("empty_text");
    const lower = normalised.toLowerCase();

    const scored = active
      .map((type) => {
        const total =
          type.keywords.reduce((s, k) => s + k.weight, 0) +
          type.regexPatterns.reduce((s, p) => s + p.weight, 0);

        const keywordHits = type.keywords.filter((k) => containsTerm(lower, k.term));
        const patternHits = type.regexPatterns.filter((p) => safeTest(p.pattern, normalised));

        const matched =
          keywordHits.reduce((s, k) => s + k.weight, 0) +
          patternHits.reduce((s, p) => s + p.weight, 0);

        const excludedHits = (type.excludeTerms ?? []).filter((t) => containsTerm(lower, t));
        const anchors = type.anchorTerms ?? [];
        const anchorMissing = anchors.length > 0 && !anchors.some((t) => containsTerm(lower, t));

        return {
          type,
          score: total > 0 ? Math.min(matched / total, 1) : 0,
          excludedHits,
          anchorMissing,
          evidence: [
            ...keywordHits.map((k) => k.term),
            ...patternHits.map((p) => `/${p.pattern}/`),
            ...excludedHits.map((t) => `excluded: ${t}`),
          ],
        };
      })
      .sort((a, b) => b.score - a.score);

    const top = scored[0]!;
    const second = scored[1];
    const margin = top.score - (second?.score ?? 0);

    let reason: ReviewReason | null = null;
    if (top.score === 0 || top.score < top.type.minConfidence) reason = "low_confidence";
    else if (top.excludedHits.length > 0) reason = "excluded_term";
    else if (top.anchorMissing) reason = "no_anchor";
    else if (margin < this.minMargin) reason = "ambiguous";

    const accepted = reason === null;

    return {
      status: accepted ? "classified" : "needs_review",
      documentTypeCode: accepted ? top.type.code : null,
      extractionProfileId: accepted ? top.type.extractionProfileId : null,
      confidence: round(top.score),
      candidates: scored
        .slice(0, 3)
        .map((s) => ({ code: s.type.code, score: round(s.score) })),
      evidence: top.evidence,
      reason,
    };
  }
}

/** Admin-supplied patterns must never be able to crash the pipeline. */
function safeTest(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return false;
  }
}
