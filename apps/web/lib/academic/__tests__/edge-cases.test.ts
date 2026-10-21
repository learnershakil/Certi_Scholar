import { describe, expect, it } from "bun:test";
import { runAcademicCheck } from "@repo/academic-engine";
import { parseAcademicRecord } from "../parse-record";
import { SAMPLE_RECORDS } from "../sample-records";
import {
  INITIAL_STATE,
  MAX_HISTORY,
  deriveView,
  workbenchReducer,
} from "../../../app/academic-verification/components/workbench-state";
import type { HistoryEntry, RecordEnvelope } from "../types";

describe("Module 6 Edge Cases & Reducer Logic", () => {
  it("workbenchReducer: loading a sample does NOT trigger check and sets state correctly", () => {
    const sample = SAMPLE_RECORDS[0]!;
    let state = workbenchReducer(INITIAL_STATE, {
      type: "load-sample",
      envelope: sample,
    });

    expect(state.selected).toBe(sample);
    expect(state.check.phase).toBe("idle");

    const view = deriveView(state.selected, state.check);
    expect(view.phase).toBe("not-checked");
  });

  it("workbenchReducer: check lifecycle from idle -> loading -> success", () => {
    const sample = SAMPLE_RECORDS[0]!;
    let state = workbenchReducer(INITIAL_STATE, {
      type: "load-sample",
      envelope: sample,
    });

    // Check starts
    state = workbenchReducer(state, {
      type: "check-started",
      recordId: sample.id,
    });
    expect(state.check.phase).toBe("loading");
    expect(deriveView(state.selected, state.check).phase).toBe("loading");

    // Check succeeds
    const checkResult = runAcademicCheck(sample.record);
    const checkedAt = new Date().toISOString();
    const entry: HistoryEntry = {
      key: "test-1",
      recordId: sample.id,
      recordLabel: sample.label,
      checkedAt,
      status: checkResult.status,
      subjectCount: sample.record.subjects.length,
      issues: checkResult.issues,
    };

    state = workbenchReducer(state, {
      type: "check-succeeded",
      recordId: sample.id,
      result: checkResult,
      checkedAt,
      entry,
    });

    expect(state.check.phase).toBe("success");
    const readyView = deriveView(state.selected, state.check);
    expect(readyView.phase).toBe("ready");
    if (readyView.phase === "ready") {
      expect(readyView.result.status).toBe("CONSISTENT");
    }
  });

  it("workbenchReducer: switching sample after check flags previous result as stale", () => {
    const sample1 = SAMPLE_RECORDS[0]!;
    const sample2 = SAMPLE_RECORDS[1]!;

    let state = workbenchReducer(INITIAL_STATE, {
      type: "load-sample",
      envelope: sample1,
    });
    const checkResult = runAcademicCheck(sample1.record);
    state = workbenchReducer(state, {
      type: "check-succeeded",
      recordId: sample1.id,
      result: checkResult,
      checkedAt: new Date().toISOString(),
      entry: {
        key: "test-1",
        recordId: sample1.id,
        recordLabel: sample1.label,
        checkedAt: new Date().toISOString(),
        status: checkResult.status,
        subjectCount: 5,
        issues: [],
      },
    });

    expect(deriveView(state.selected, state.check).phase).toBe("ready");

    // Load second sample without checking
    state = workbenchReducer(state, {
      type: "load-sample",
      envelope: sample2,
    });

    expect(state.selected?.id).toBe(sample2.id);
    // View should now be stale because result belongs to sample1
    expect(deriveView(state.selected, state.check).phase).toBe("stale");
  });

  it("workbenchReducer: caps history at MAX_HISTORY", () => {
    let state = INITIAL_STATE;
    const sample = SAMPLE_RECORDS[0]!;

    for (let i = 0; i < 15; i++) {
      const entry: HistoryEntry = {
        key: `test-${i}`,
        recordId: sample.id,
        recordLabel: sample.label,
        checkedAt: new Date().toISOString(),
        status: "CONSISTENT",
        subjectCount: 5,
        issues: [],
      };
      state = workbenchReducer(state, {
        type: "check-succeeded",
        recordId: sample.id,
        result: runAcademicCheck(sample.record),
        checkedAt: entry.checkedAt,
        entry,
      });
    }

    expect(state.history.length).toBe(MAX_HISTORY);
    expect(state.history[0]?.key).toBe("test-14"); // Newest first
  });

  it("workbenchReducer: reset-view clears state and check", () => {
    const sample = SAMPLE_RECORDS[0]!;
    let state = workbenchReducer(INITIAL_STATE, {
      type: "load-sample",
      envelope: sample,
    });
    state = workbenchReducer(state, { type: "reset-view" });

    expect(state.selected).toBeUndefined();
    expect(state.check.phase).toBe("idle");
    expect(deriveView(state.selected, state.check).phase).toBe("not-checked");
  });
});

describe("Boundary Edge Cases in Academic Engine Calculations", () => {
  it("handles 0 marks across all subjects (0% boundary)", () => {
    const record = {
      subjects: [
        { subject: "Sub1", obtained: 0, maximum: 100 },
        { subject: "Sub2", obtained: 0, maximum: 100 },
      ],
      printedTotal: 0,
      printedPercentage: 0,
    };
    const res = runAcademicCheck(record);
    expect(res.status).toBe("CONSISTENT");
    expect(res.calculated?.totalObtained).toBe(0);
    expect(res.calculated?.totalMaximum).toBe(200);
    expect(res.calculated?.percentage).toBe(0);
  });

  it("handles perfect marks across all subjects (100% boundary)", () => {
    const record = {
      subjects: [
        { subject: "Sub1", obtained: 100, maximum: 100 },
        { subject: "Sub2", obtained: 50, maximum: 50 },
      ],
      printedTotal: 150,
      printedPercentage: 100,
    };
    const res = runAcademicCheck(record);
    expect(res.status).toBe("CONSISTENT");
    expect(res.calculated?.totalObtained).toBe(150);
    expect(res.calculated?.totalMaximum).toBe(150);
    expect(res.calculated?.percentage).toBe(100);
  });

  it("handles decimal marks and non-uniform maximum marks", () => {
    const record = {
      subjects: [
        { subject: "Lab", obtained: 42.5, maximum: 50 },
        { subject: "Theory", obtained: 67.5, maximum: 75 },
      ],
      printedTotal: 110,
      printedPercentage: 88,
    };
    const res = runAcademicCheck(record);
    expect(res.status).toBe("CONSISTENT");
    expect(res.calculated?.totalObtained).toBe(110);
    expect(res.calculated?.totalMaximum).toBe(125);
    expect(res.calculated?.percentage).toBe(88);
  });

  it("detects when only printedTotal is inconsistent but printedPercentage matches", () => {
    const record = {
      subjects: [
        { subject: "A", obtained: 80, maximum: 100 },
        { subject: "B", obtained: 80, maximum: 100 },
      ],
      printedTotal: 170, // Inconsistent (calculated is 160)
      printedPercentage: 80, // Matches (160/200 = 80%)
    };
    const res = runAcademicCheck(record);
    expect(res.status).toBe("INCONSISTENT");
    expect(res.issues.some((i) => i.toLowerCase().includes("total"))).toBe(true);
  });

  it("detects when only printedPercentage is inconsistent but printedTotal matches", () => {
    const record = {
      subjects: [
        { subject: "A", obtained: 80, maximum: 100 },
        { subject: "B", obtained: 80, maximum: 100 },
      ],
      printedTotal: 160, // Matches
      printedPercentage: 85, // Inconsistent
    };
    const res = runAcademicCheck(record);
    expect(res.status).toBe("INCONSISTENT");
    expect(res.issues.some((i) => i.toLowerCase().includes("percentage"))).toBe(true);
  });

  it("marks missing printed values as NEEDS_REVIEW", () => {
    const recordBothMissing = {
      subjects: [{ subject: "A", obtained: 80, maximum: 100 }],
    };
    expect(runAcademicCheck(recordBothMissing).status).toBe("NEEDS_REVIEW");

    const recordTotalMissing = {
      subjects: [{ subject: "A", obtained: 80, maximum: 100 }],
      printedPercentage: 80,
    };
    expect(runAcademicCheck(recordTotalMissing).status).toBe("NEEDS_REVIEW");

    const recordPercentageMissing = {
      subjects: [{ subject: "A", obtained: 80, maximum: 100 }],
      printedTotal: 80,
    };
    expect(runAcademicCheck(recordPercentageMissing).status).toBe("NEEDS_REVIEW");
  });

  it("marks invalid subject marks as NEEDS_REVIEW with issues", () => {
    // Marks exceed maximum
    const resExceed = runAcademicCheck({
      subjects: [{ subject: "A", obtained: 105, maximum: 100 }],
    });
    expect(resExceed.status).toBe("NEEDS_REVIEW");
    expect(resExceed.issues.length).toBeGreaterThan(0);

    // Negative marks
    const resNegative = runAcademicCheck({
      subjects: [{ subject: "A", obtained: -5, maximum: 100 }],
    });
    expect(resNegative.status).toBe("NEEDS_REVIEW");

    // Invalid maximum (0)
    const resZeroMax = runAcademicCheck({
      subjects: [{ subject: "A", obtained: 10, maximum: 0 }],
    });
    expect(resZeroMax.status).toBe("NEEDS_REVIEW");

    // Empty subjects
    const resEmpty = runAcademicCheck({ subjects: [] });
    expect(resEmpty.status).toBe("NEEDS_REVIEW");
  });
});

describe("Record Parsing & Payload Validation", () => {
  it("parses valid record correctly", () => {
    const body = {
      subjects: [
        { subject: "Math", obtained: 90, maximum: 100 },
      ],
      printedTotal: 90,
      printedPercentage: 90,
    };
    const parsed = parseAcademicRecord(body);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.record.subjects[0]?.subject).toBe("Math");
      expect(parsed.record.printedTotal).toBe(90);
    }
  });

  it("rejects non-object or null body", () => {
    expect(parseAcademicRecord(null).ok).toBe(false);
    expect(parseAcademicRecord("not a record").ok).toBe(false);
    expect(parseAcademicRecord(123).ok).toBe(false);
  });

  it("handles empty subjects array at parse stage and delegates validation to engine", () => {
    const parsedEmpty = parseAcademicRecord({ subjects: [] });
    expect(parsedEmpty.ok).toBe(true);
    if (parsedEmpty.ok) {
      const checkRes = runAcademicCheck(parsedEmpty.record);
      expect(checkRes.status).toBe("NEEDS_REVIEW");
      expect(checkRes.issues.some((i) => i.toLowerCase().includes("no subjects"))).toBe(true);
    }
  });

  it("rejects invalid subjects structures", () => {
    expect(parseAcademicRecord({}).ok).toBe(false);
    expect(parseAcademicRecord({ subjects: "not an array" }).ok).toBe(false);
    expect(
      parseAcademicRecord({
        subjects: [{ subject: 123, obtained: 90, maximum: 100 }],
      }).ok,
    ).toBe(false);
    expect(
      parseAcademicRecord({
        subjects: [{ subject: "Math", obtained: "90", maximum: 100 }],
      }).ok,
    ).toBe(false);
  });
});
