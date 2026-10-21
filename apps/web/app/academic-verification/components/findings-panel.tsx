import {
  formatMarks,
  formatPercentage,
  formatSignedDifference,
  missingPrintedFields,
  printedMinusCalculated,
} from "../../../lib/academic/display";
import type { RecordEnvelope } from "../../../lib/academic/types";
import panels from "../panels.module.css";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  InfoIcon,
  XCircleIcon,
} from "./icons";
import { Panel } from "./panel";
import { placeholderText, type ResultView } from "./result-view";
import { StatusBadge } from "./status-badge";

interface FindingsPanelProps {
  envelope: RecordEnvelope;
  view: ResultView;
}

export function FindingsPanel({ envelope, view }: FindingsPanelProps) {
  if (view.phase !== "ready") {
    return (
      <Panel id="findings" title="Consistency Findings & Verdict">
        <div className={panels.awaitingContainer}>
          <InfoIcon className={panels.awaitingIcon} />
          <div>
            <p className={panels.awaitingTitle}>{placeholderText(view)}</p>
          </div>
        </div>
      </Panel>
    );
  }

  const { result } = view;
  const { record } = envelope;
  const calculated = result.calculated;

  const totalDiff = printedMinusCalculated(
    record.printedTotal,
    calculated?.totalObtained,
  );
  const pctDiff = printedMinusCalculated(
    record.printedPercentage,
    calculated?.percentage,
  );

  const missingFields = missingPrintedFields(record);
  const missingFieldNames = missingFields
    .map((f) => (f === "total" ? "Total Marks Obtained" : "Academic Percentage"))
    .join(" and ");

  let inconsistentDesc =
    "Discrepancy detected between printed document figures and recalculated subject marks.";
  if (
    pctDiff !== undefined &&
    Math.abs(pctDiff) > 0.01 &&
    totalDiff !== undefined &&
    Math.abs(totalDiff) > 0.01
  ) {
    inconsistentDesc = `Both printed total (${formatMarks(record.printedTotal!)} vs calc ${calculated ? formatMarks(calculated.totalObtained) : "N/A"}) and percentage (${formatPercentage(record.printedPercentage!)} vs calc ${calculated ? formatPercentage(calculated.percentage) : "N/A"}) differ from recalculated marks.`;
  } else if (pctDiff !== undefined && Math.abs(pctDiff) > 0.01) {
    inconsistentDesc = `Printed percentage (${formatPercentage(record.printedPercentage!)}) does not match recalculated percentage (${calculated ? formatPercentage(calculated.percentage) : "N/A"}, difference: ${formatSignedDifference(pctDiff)} pp).`;
  } else if (totalDiff !== undefined && Math.abs(totalDiff) > 0.01) {
    inconsistentDesc = `Printed total (${formatMarks(record.printedTotal!)}) does not match recalculated sum of obtained marks (${calculated ? formatMarks(calculated.totalObtained) : "N/A"}, difference: ${formatSignedDifference(totalDiff)}).`;
  }

  let reviewDesc =
    "Administrative inspection required to verify record authenticity and completeness.";
  if (missingFields.length > 0) {
    reviewDesc = `Printed ${missingFieldNames} absent from the document. Recalculation yielded ${calculated ? `${formatMarks(calculated.totalObtained)} / ${formatMarks(calculated.totalMaximum)} marks (${formatPercentage(calculated.percentage)})` : "values"}, but manual verification against physical records is required.`;
  } else if (result.issues.length > 0) {
    reviewDesc = `Validation anomalies detected in subject marks: ${result.issues.join("; ")}. Human review required.`;
  }

  return (
    <Panel
      id="findings"
      title="Consistency Findings & Verdict"
      aside={<StatusBadge status={result.status} />}
    >
      {/* Verdict Alert Banner */}
      {result.status === "CONSISTENT" && calculated && (
        <div className={panels.verdictConsistent}>
          <div className={panels.verdictIconWrap}>
            <CheckCircleIcon className={panels.verdictIcon} />
          </div>
          <div>
            <h3 className={panels.verdictTitle}>
              Consistent: Academic Totals Fully Reconciled
            </h3>
            <p className={panels.verdictDesc}>
              All {record.subjects.length} subjects verified successfully. Recalculated total of{" "}
              <strong>{formatMarks(calculated.totalObtained)}</strong> /{" "}
              <strong>{formatMarks(calculated.totalMaximum)}</strong> marks (
              <strong>{formatPercentage(calculated.percentage)}</strong>) exactly matches printed
              values on the document.
            </p>
          </div>
        </div>
      )}

      {result.status === "INCONSISTENT" && (
        <div className={panels.verdictInconsistent}>
          <div className={panels.verdictIconWrap}>
            <XCircleIcon className={panels.verdictIcon} />
          </div>
          <div>
            <h3 className={panels.verdictTitle}>
              Inconsistent: Discrepancy Detected Between Values
            </h3>
            <p className={panels.verdictDesc}>{inconsistentDesc}</p>
          </div>
        </div>
      )}

      {result.status === "NEEDS_REVIEW" && (
        <div className={panels.verdictNeedsReview}>
          <div className={panels.verdictIconWrap}>
            <AlertTriangleIcon className={panels.verdictIcon} />
          </div>
          <div>
            <h3 className={panels.verdictTitle}>
              Needs Review: Administrative Inspection Required
            </h3>
            <p className={panels.verdictDesc}>{reviewDesc}</p>
          </div>
        </div>
      )}

      {/* KPI Overview Pills */}
      <div className={panels.findingsPillRow}>
        <div className={panels.findingsPill}>
          <span className={panels.pillLabel}>Engine Status</span>
          <span className={panels.pillValue}>
            <StatusBadge status={result.status} size="sm" />
          </span>
        </div>
        <div className={panels.findingsPill}>
          <span className={panels.pillLabel}>Engine Issues</span>
          <span className={panels.pillValue}>
            {result.issues.length === 0 ? "0 issues" : `${result.issues.length} flagged`}
          </span>
        </div>
        <div className={panels.findingsPill}>
          <span className={panels.pillLabel}>Action Required</span>
          <span className={panels.pillValue}>
            {result.status === "CONSISTENT"
              ? "None"
              : result.status === "INCONSISTENT"
                ? "Flag discrepancy"
                : "Manual verification"}
          </span>
        </div>
      </div>

      {/* Authoritative Engine Issue Messages */}
      <div className={panels.issuesSection}>
        <h4 className={panels.issuesHeading}>
          Authoritative Engine Messages ({result.issues.length})
        </h4>
        {result.status === "CONSISTENT" ? (
          <div className={panels.noIssuesNotice}>
            <CheckCircleIcon className={panels.noIssuesIcon} />
            <span>
              Record verified successfully: Total marks (
              {calculated ? formatMarks(calculated.totalObtained) : "—"} /{" "}
              {calculated ? formatMarks(calculated.totalMaximum) : "—"}) and percentage (
              {calculated ? formatPercentage(calculated.percentage) : "—"}) match printed values with 0
              discrepancies.
            </span>
          </div>
        ) : result.status === "NEEDS_REVIEW" && result.issues.length === 0 ? (
          <div className={panels.reviewNotice}>
            <AlertTriangleIcon className={panels.reviewNoticeIcon} />
            <span>
              {missingFields.length > 0
                ? `Fields requiring review: Missing printed ${missingFieldNames} on document. Recalculation completed (${calculated ? `${formatMarks(calculated.totalObtained)} / ${formatMarks(calculated.totalMaximum)} marks, ${formatPercentage(calculated.percentage)}` : ""}), but automated reconciliation cannot be completed without printed values.`
                : "Manual verification required: Document requires administrative inspection."}
            </span>
          </div>
        ) : result.issues.length === 0 ? (
          <div className={panels.noIssuesNotice}>
            <CheckCircleIcon className={panels.noIssuesIcon} />
            <span>The academic engine returned 0 issue messages.</span>
          </div>
        ) : (
          <ul className={panels.issueList}>
            {result.issues.map((issue, index) => (
              <li key={`${index}-${issue}`} className={panels.issueItem}>
                <AlertTriangleIcon className={panels.issueItemIcon} />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}