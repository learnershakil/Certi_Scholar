import {
  formatMarks,
  formatPercentage,
  formatSignedDifference,
  printedMinusCalculated,
} from "../../../lib/academic/display";
import type { RecordEnvelope } from "../../../lib/academic/types";
import panels from "../panels.module.css";
import styles from "../workbench.module.css";
import { cx } from "./cx";
import { CheckCircleIcon, InfoIcon, XCircleIcon } from "./icons";
import { Panel } from "./panel";
import { placeholderText, type ResultView } from "./result-view";
import { StatusBadge } from "./status-badge";

interface ReconciliationPanelProps {
  envelope: RecordEnvelope;
  view: ResultView;
}

function calculatedText(
  view: ResultView,
  value: number | undefined,
  format: (value: number) => string,
): string {
  if (view.phase !== "ready") {
    return placeholderText(view);
  }
  if (value === undefined) {
    return "N/A";
  }
  return format(value);
}

export function ReconciliationPanel({ envelope, view }: ReconciliationPanelProps) {
  const { record } = envelope;
  const isReady = view.phase === "ready";
  const calculated = isReady ? view.result.calculated : undefined;

  const totalDifference = printedMinusCalculated(
    record.printedTotal,
    calculated?.totalObtained,
  );
  const percentageDifference = printedMinusCalculated(
    record.printedPercentage,
    calculated?.percentage,
  );

  const totalMatches = totalDifference !== undefined && Math.abs(totalDifference) <= 0.01;
  const percentageMatches =
    percentageDifference !== undefined && Math.abs(percentageDifference) <= 0.01;

  const hasBothTotals =
    isReady &&
    record.printedTotal !== undefined &&
    calculated?.totalObtained !== undefined;
  const totalRowClass = hasBothTotals
    ? totalMatches
      ? styles.rowMatch
      : styles.rowMismatch
    : undefined;

  const hasBothPercentages =
    isReady &&
    record.printedPercentage !== undefined &&
    calculated?.percentage !== undefined;
  const percentageRowClass = hasBothPercentages
    ? percentageMatches
      ? styles.rowMatch
      : styles.rowMismatch
    : undefined;

  return (
    <Panel
      id="reconciliation"
      title="Printed vs Recalculated Reconciliation"
      aside={
        <div className={panels.headerStatusWrap}>
          {isReady ? (
            <StatusBadge status={view.result.status} size="sm" />
          ) : (
            <StatusBadge
              status="NOT_CHECKED"
              label={placeholderText(view)}
              size="sm"
            />
          )}
        </div>
      }
    >
      <div
        className={styles.tableWrap}
        role="region"
        aria-label="Reconciliation comparison table"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Academic Metric</th>
              <th scope="col" className={styles.num}>
                Printed on Document
              </th>
              <th scope="col" className={styles.num}>
                Engine Recalculated
              </th>
              <th scope="col" className={styles.colDelta}>
                Difference (Printed − Calc)
              </th>
              <th scope="col" className={styles.colReconStatus}>
                Reconciliation State
              </th>
            </tr>
          </thead>
          <tbody>
            {/* 1. Total Obtained Marks */}
            <tr className={totalRowClass}>
              <th scope="row">
                <div className={panels.metricTitle}>Total Marks Obtained</div>
              </th>
              <td className={styles.num}>
                {record.printedTotal === undefined ? (
                  <span className={styles.textMuted}>N/A</span>
                ) : (
                  <strong>{formatMarks(record.printedTotal)}</strong>
                )}
              </td>
              <td className={styles.num}>
                <strong>
                  {calculatedText(view, calculated?.totalObtained, formatMarks)}
                </strong>
              </td>
              <td className={styles.colDelta}>
                {totalDifference !== undefined ? (
                  <span
                    className={cx(
                      styles.deltaBadge,
                      totalMatches ? styles.deltaBadgeMatch : styles.deltaBadgeMismatch,
                    )}
                  >
                    {totalDifference === 0
                      ? "0 (Exact)"
                      : formatSignedDifference(totalDifference)}
                  </span>
                ) : (
                  <span className={styles.textMuted}>—</span>
                )}
              </td>
              <td className={styles.colReconStatus}>
                {!isReady ? (
                  <span className={styles.textMuted}>{placeholderText(view)}</span>
                ) : record.printedTotal === undefined ? (
                  <span className={styles.reconMissing}>
                    <InfoIcon className={styles.inlineIconSm} />
                    <span>Printed value absent</span>
                  </span>
                ) : calculated?.totalObtained === undefined ? (
                  <span className={styles.reconMissing}>
                    <InfoIcon className={styles.inlineIconSm} />
                    <span>Calculation unavailable</span>
                  </span>
                ) : totalMatches ? (
                  <span className={styles.reconMatch}>
                    <CheckCircleIcon className={styles.inlineIconSm} />
                    <span>Reconciled</span>
                  </span>
                ) : (
                  <span className={styles.reconMismatch}>
                    <XCircleIcon className={styles.inlineIconSm} />
                    <span>Discrepancy</span>
                  </span>
                )}
              </td>
            </tr>

            {/* 2. Total Possible Marks */}
            <tr>
              <th scope="row">
                <div className={panels.metricTitle}>Total Maximum Marks</div>
              </th>
              <td className={styles.num}>
                <span className={styles.textMuted}>N/A</span>
              </td>
              <td className={styles.num}>
                <strong>
                  {calculatedText(view, calculated?.totalMaximum, formatMarks)}
                </strong>
              </td>
              <td className={styles.colDelta}>
                <span className={styles.textMuted}>—</span>
              </td>
              <td className={styles.colReconStatus}>
                {!isReady ? (
                  <span className={styles.textMuted}>{placeholderText(view)}</span>
                ) : calculated?.totalMaximum !== undefined ? (
                  <span className={styles.reconMissing}>
                    <InfoIcon className={styles.inlineIconSm} />
                    <span>Computed from subjects</span>
                  </span>
                ) : (
                  <span className={styles.textMuted}>N/A</span>
                )}
              </td>
            </tr>

            {/* 3. Aggregate Percentage */}
            <tr className={percentageRowClass}>
              <th scope="row">
                <div className={panels.metricTitle}>Academic Percentage</div>
              </th>
              <td className={styles.num}>
                {record.printedPercentage === undefined ? (
                  <span className={styles.textMuted}>N/A</span>
                ) : (
                  <strong>{formatPercentage(record.printedPercentage)}</strong>
                )}
              </td>
              <td className={styles.num}>
                <strong>
                  {calculatedText(view, calculated?.percentage, formatPercentage)}
                </strong>
              </td>
              <td className={styles.colDelta}>
                {percentageDifference !== undefined ? (
                  <span
                    className={cx(
                      styles.deltaBadge,
                      percentageMatches
                        ? styles.deltaBadgeMatch
                        : styles.deltaBadgeMismatch,
                    )}
                  >
                    {percentageDifference === 0
                      ? "0 pp (Exact)"
                      : `${formatSignedDifference(percentageDifference)} pp`}
                  </span>
                ) : (
                  <span className={styles.textMuted}>—</span>
                )}
              </td>
              <td className={styles.colReconStatus}>
                {!isReady ? (
                  <span className={styles.textMuted}>{placeholderText(view)}</span>
                ) : record.printedPercentage === undefined ? (
                  <span className={styles.reconMissing}>
                    <InfoIcon className={styles.inlineIconSm} />
                    <span>Printed value absent</span>
                  </span>
                ) : calculated?.percentage === undefined ? (
                  <span className={styles.reconMissing}>
                    <InfoIcon className={styles.inlineIconSm} />
                    <span>Calculation unavailable</span>
                  </span>
                ) : percentageMatches ? (
                  <span className={styles.reconMatch}>
                    <CheckCircleIcon className={styles.inlineIconSm} />
                    <span>Reconciled</span>
                  </span>
                ) : (
                  <span className={styles.reconMismatch}>
                    <XCircleIcon className={styles.inlineIconSm} />
                    <span>Discrepancy</span>
                  </span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}