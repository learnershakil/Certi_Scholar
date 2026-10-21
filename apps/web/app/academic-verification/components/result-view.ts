import type { AcademicEngineResult } from "@repo/academic-engine";

/**
 * What the panels are allowed to show for the CURRENT record.
 * The workbench decides this once. Panels never receive a result that
 * belongs to a different record.
 */
export type ResultView =
  | { phase: "not-checked" }
  | { phase: "loading" }
  | { phase: "stale" }
  | { phase: "failed" }
  | { phase: "ready"; result: AcademicEngineResult; checkedAt: string };

export function placeholderText(
  view: Exclude<ResultView, { phase: "ready" }>,
): string {
  switch (view.phase) {
    case "not-checked":
      return "Not checked yet";
    case "loading":
      return "Checking…";
    case "stale":
      return "Stale: run the check again";
    case "failed":
      return "Check failed";
  }
}