import type { ReactNode } from "react";
import type { AcademicEngineResult } from "@repo/academic-engine";
import { formatMarks, formatPercentage } from "../../../lib/academic/display";
import type { RecordEnvelope } from "../../../lib/academic/types";
import styles from "../workbench.module.css";
import { cx } from "./cx";
import { StatusBadge } from "./status-badge";

interface MetricStripProps {
  envelope: RecordEnvelope | undefined;
  result: AcademicEngineResult | undefined;
  /** True when `result` belongs to a different record than `envelope`. */
  stale: boolean;
  loading: boolean;
}

interface MetricCardProps {
  label: string;
  value: ReactNode;
  subtitle?: string;
  isMessage?: boolean;
  muted?: boolean;
  accent?: "default" | "consistent" | "inconsistent" | "needs-review";
}

function MetricCard({
  label,
  value,
  subtitle,
  isMessage = false,
  muted = false,
  accent = "default",
}: MetricCardProps) {
  return (
    <div
      className={cx(
        styles.kpiCard,
        muted && styles.kpiMuted,
        accent === "consistent" && styles.kpiConsistent,
        accent === "inconsistent" && styles.kpiInconsistent,
        accent === "needs-review" && styles.kpiNeedsReview,
      )}
    >
      <dt className={styles.kpiLabel}>{label}</dt>
      <dd className={cx(styles.kpiValue, isMessage && styles.kpiMessage)}>
        {value}
      </dd>
      {subtitle ? <dd className={styles.kpiSubtitle}>{subtitle}</dd> : null}
    </div>
  );
}

export function MetricStrip({
  envelope,
  result,
  stale,
  loading,
}: MetricStripProps) {
  const calculated = result?.calculated;
  const isPending = loading || (!result && !calculated);
  const muted = stale && !loading;

  // Total Obtained display logic
  const obtainedValue = loading
    ? "Checking…"
    : calculated
      ? formatMarks(calculated.totalObtained)
      : result
        ? "N/A"
        : "Awaiting check";

  // Total Possible display logic
  const possibleValue = loading
    ? "Checking…"
    : calculated
      ? formatMarks(calculated.totalMaximum)
      : result
        ? "N/A"
        : "Awaiting check";

  // Percentage display logic
  const percentageValue = loading
    ? "Checking…"
    : calculated
      ? formatPercentage(calculated.percentage)
      : result
        ? "N/A"
        : "Awaiting check";

  // Verdict accent determination
  let verdictAccent: "default" | "consistent" | "inconsistent" | "needs-review" =
    "default";
  if (result && !loading && !stale) {
    if (result.status === "CONSISTENT") verdictAccent = "consistent";
    else if (result.status === "INCONSISTENT") verdictAccent = "inconsistent";
    else if (result.status === "NEEDS_REVIEW") verdictAccent = "needs-review";
  }

  return (
    <section aria-label="Results Summary Metrics">
      <dl className={styles.kpiGrid}>
        {/* 1. Subjects Received */}
        <MetricCard
          label="Subjects Received"
          value={envelope ? String(envelope.record.subjects.length) : "—"}
        />

        {/* 2. Total Marks Obtained */}
        <MetricCard
          label="Total Marks Obtained"
          value={obtainedValue}
          isMessage={isPending}
          muted={muted}
        />

        {/* 3. Total Marks Possible */}
        <MetricCard
          label="Total Marks Possible"
          value={possibleValue}
          isMessage={isPending}
          muted={muted}
        />

        {/* 4. Recalculated Percentage */}
        <MetricCard
          label="Recalculated Percentage"
          value={percentageValue}
          isMessage={isPending}
          muted={muted}
        />

        {/* 5. Overall Consistency Verdict */}
        <MetricCard
          label="Consistency Verdict"
          accent={verdictAccent}
          value={
            loading ? (
              <StatusBadge status="NOT_CHECKED" label="Checking…" size="md" />
            ) : result ? (
              <StatusBadge status={result.status} stale={stale} size="md" />
            ) : (
              <StatusBadge status="NOT_CHECKED" label="Awaiting check" size="md" />
            )
          }
        />
      </dl>
    </section>
  );
}