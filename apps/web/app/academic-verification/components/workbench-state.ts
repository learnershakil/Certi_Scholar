import type { AcademicEngineResult } from "@repo/academic-engine";
import { SAMPLE_RECORDS } from "../../../lib/academic/sample-records";
import type {
  CheckErrorKind,
  CheckState,
  HistoryEntry,
  RecordEnvelope,
} from "../../../lib/academic/types";
import type { ResultView } from "./result-view";

export const MAX_HISTORY = 10;

export interface WorkbenchState {
  /** Sample chosen in the dropdown but not necessarily loaded yet. */
  pendingSampleId: string;
  /** The record currently shown. Read-only. */
  selected: RecordEnvelope | undefined;
  check: CheckState;
  /** Newest first. In memory only. */
  history: HistoryEntry[];
}

export const INITIAL_STATE: WorkbenchState = {
  pendingSampleId: SAMPLE_RECORDS[0]?.id ?? "",
  selected: undefined,
  check: { phase: "idle" },
  history: [],
};

export type WorkbenchAction =
  | { type: "choose-sample"; id: string }
  | { type: "load-sample"; envelope: RecordEnvelope }
  | { type: "reset-view" }
  | { type: "check-started"; recordId: string }
  | {
      type: "check-succeeded";
      recordId: string;
      result: AcademicEngineResult;
      checkedAt: string;
      entry: HistoryEntry;
    }
  | {
      type: "check-failed";
      recordId: string;
      kind: CheckErrorKind;
      message: string;
      details?: string[] | undefined;
    };

export function workbenchReducer(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
  switch (action.type) {
    case "choose-sample":
      return { ...state, pendingSampleId: action.id };

    case "load-sample":
      return {
        ...state,
        selected: action.envelope,
        // Keep an old successful result so it can be shown as stale.
        // Drop loading and error states, which belong to the old record.
        check: state.check.phase === "success" ? state.check : { phase: "idle" },
      };

    case "reset-view":
      return { ...state, selected: undefined, check: { phase: "idle" } };

    case "check-started":
      return { ...state, check: { phase: "loading", recordId: action.recordId } };

    case "check-succeeded":
      return {
        ...state,
        check: {
          phase: "success",
          recordId: action.recordId,
          result: action.result,
          checkedAt: action.checkedAt,
        },
        history: [action.entry, ...state.history].slice(0, MAX_HISTORY),
      };

    case "check-failed":
      return {
        ...state,
        check: {
          phase: "error",
          recordId: action.recordId,
          kind: action.kind,
          message: action.message,
          ...(action.details ? { details: action.details } : {}),
        },
      };
  }
}

/**
 * What the panels may show for the SELECTED record.
 * A result that belongs to a different record is reported as "stale".
 */
export function deriveView(
  selected: RecordEnvelope | undefined,
  check: CheckState,
): ResultView {
  if (!selected) {
    return { phase: "not-checked" };
  }

  switch (check.phase) {
    case "idle":
      return { phase: "not-checked" };
    case "loading":
      return { phase: "loading" };
    case "success":
      return check.recordId === selected.id
        ? { phase: "ready", result: check.result, checkedAt: check.checkedAt }
        : { phase: "stale" };
    case "error":
      return check.recordId === selected.id
        ? { phase: "failed" }
        : { phase: "not-checked" };
  }
}

/** Text for the screen-reader live region. */
export function describeCheck(check: CheckState): string {
  switch (check.phase) {
    case "idle":
      return "";
    case "loading":
      return "Running consistency check.";
    case "success":
      return `Consistency check complete. Engine status: ${check.result.status}.`;
    case "error":
      return "The consistency check failed.";
  }
}