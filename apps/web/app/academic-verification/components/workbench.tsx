"use client";

import { useReducer, useRef } from "react";
import { requestAcademicCheck } from "../../../lib/academic/request-check";
import {
  SAMPLE_RECORDS,
  findSampleById,
} from "../../../lib/academic/sample-records";
import type { RecordEnvelope } from "../../../lib/academic/types";
import shell from "../shell.module.css";
import styles from "../workbench.module.css";
import { ActionBar } from "./action-bar";
import { CalculationInspector } from "./calculation-inspector";
import { EmptyState } from "./empty-state";
import { FindingsPanel } from "./findings-panel";
import { MetricStrip } from "./metric-strip";
import { ErrorNotice, StaleNotice } from "./notices";
import { PageHeader } from "./page-header";
import { ReconciliationPanel } from "./reconciliation-panel";
import { RecordPanel } from "./record-panel";
import { SessionHistory } from "./session-history";
import {
  INITIAL_STATE,
  deriveView,
  describeCheck,
  workbenchReducer,
} from "./workbench-state";

export function Workbench() {
  const [state, dispatch] = useReducer(workbenchReducer, INITIAL_STATE);

  // Counts check requests. Changing it makes any in-flight response obsolete.
  // Only touched inside event handlers, never during render.
  const requestCounter = useRef(0);

  const { selected, check, history } = state;
  const view = deriveView(selected, check);
  const loading = check.phase === "loading";
  const stale = view.phase === "stale";
  const result = check.phase === "success" ? check.result : undefined;
  const readyResult = view.phase === "ready" ? view.result : undefined;

  async function runCheck(envelope: RecordEnvelope): Promise<void> {
    requestCounter.current += 1;
    const requestId = requestCounter.current;

    dispatch({ type: "check-started", recordId: envelope.id });
    const outcome = await requestAcademicCheck(envelope.record);

    // A newer action (another check, load or reset) superseded this one.
    if (requestCounter.current !== requestId) {
      return;
    }

    if (outcome.ok) {
      const checkedAt = new Date().toISOString();
      dispatch({
        type: "check-succeeded",
        recordId: envelope.id,
        result: outcome.result,
        checkedAt,
        entry: {
          key: `check-${requestId}`,
          recordId: envelope.id,
          recordLabel: envelope.label,
          checkedAt,
          status: outcome.result.status,
          subjectCount: envelope.record.subjects.length,
          issues: outcome.result.issues,
          recalculatedPercentage: outcome.result.calculated?.percentage,
          totalObtained: outcome.result.calculated?.totalObtained,
          totalMaximum: outcome.result.calculated?.totalMaximum,
        },
      });
      return;
    }

    dispatch({
      type: "check-failed",
      recordId: envelope.id,
      kind: outcome.kind,
      message: outcome.message,
      details: outcome.details,
    });
  }

  function handleRun() {
    if (selected) {
      void runCheck(selected);
    }
  }

  function handleLoadSample() {
    const sample = findSampleById(state.pendingSampleId);
    if (!sample) {
      return;
    }
    requestCounter.current += 1;
    dispatch({ type: "load-sample", envelope: sample });
  }

  function handleLoadRecordById(id: string) {
    const sample = findSampleById(id);
    if (!sample) {
      return;
    }
    requestCounter.current += 1;
    dispatch({ type: "choose-sample", id });
    dispatch({ type: "load-sample", envelope: sample });
  }

  function handleReset() {
    requestCounter.current += 1;
    dispatch({ type: "reset-view" });
  }

  return (
    <div className={styles.workbench}>
      <main className={shell.container}>
        {/* Compact Page Header with Breadcrumbs & Collapsible Guide */}
        <PageHeader />

        {/* Action Bar: Sample Selector, Primary Run Button, Reset & Print */}
        <ActionBar
          envelope={selected}
          samples={SAMPLE_RECORDS}
          pendingSampleId={state.pendingSampleId}
          loading={loading}
          onChooseSample={(id) => dispatch({ type: "choose-sample", id })}
          onLoadSample={handleLoadSample}
          onRun={handleRun}
          onReset={handleReset}
        />

        {/* Error and Stale Status Notices */}
        {check.phase === "error" ? (
          <ErrorNotice
            kind={check.kind}
            message={check.message}
            details={check.details}
            onRetry={handleRun}
          />
        ) : null}

        {stale ? <StaleNotice /> : null}

        {/* Results Summary: 4 KPI Cards + 1 Consistency Verdict */}
        <MetricStrip
          envelope={selected}
          result={result}
          stale={stale}
          loading={loading}
        />

        {/* Academic Records Breakdown, Side-by-Side Reconciliation & Findings */}
        {selected ? (
          <>
            <RecordPanel
              envelope={selected}
              calculated={readyResult?.calculated}
              loading={loading}
            />
            <ReconciliationPanel envelope={selected} view={view} />
            <FindingsPanel envelope={selected} view={view} />
            <CalculationInspector envelope={selected} view={view} />
          </>
        ) : (
          <EmptyState
            onLoadFirstSample={() =>
              handleLoadRecordById(SAMPLE_RECORDS[0]?.id ?? "")
            }
          />
        )}

        {/* Recent Checks Session Audit Trail */}
        <SessionHistory
          entries={history}
          onLoadRecord={handleLoadRecordById}
        />

        {/* Live region for accessibility / screen readers */}
        <p role="status" className={shell.srOnly}>
          {describeCheck(check)}
        </p>
      </main>
    </div>
  );
}