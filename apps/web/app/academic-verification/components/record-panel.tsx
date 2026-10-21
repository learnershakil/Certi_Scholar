"use client";

import { useState } from "react";
import type { AcademicEngineResult } from "@repo/academic-engine";
import type { RecordEnvelope } from "../../../lib/academic/types";
import styles from "../workbench.module.css";
import { ChevronDownIcon, ChevronUpIcon } from "./icons";
import { MarksBars } from "./marks-bars";
import { Panel } from "./panel";
import { SubjectTable } from "./subject-table";

interface RecordPanelProps {
  envelope: RecordEnvelope;
  calculated?: AcademicEngineResult["calculated"];
  loading?: boolean;
}

export function RecordPanel({
  envelope,
  calculated,
  loading = false,
}: RecordPanelProps) {
  const [showBars, setShowBars] = useState(false);
  const { record } = envelope;

  return (
    <Panel
      id="record"
      title="Academic Record & Subject Marks"
      aside={
        <div className={styles.panelHeaderMeta}>
          <span className={styles.sourceTag}>
            {envelope.source === "demo" ? "Synthetic Sample" : "Upstream Data"}
          </span>
        </div>
      }
    >
      {/* Record info & printed values ribbon */}
      <div className={styles.recordMetadataBar}>
        <div className={styles.metaCell}>
          <span className={styles.metaLabel}>Printed Total (as supplied):</span>
          <span className={styles.metaValue}>
            {record.printedTotal !== undefined ? (
              <strong>{record.printedTotal}</strong>
            ) : (
              <span className={styles.textMuted}>N/A</span>
            )}
          </span>
        </div>

        <div className={styles.metaCell}>
          <span className={styles.metaLabel}>Printed Percentage (as supplied):</span>
          <span className={styles.metaValue}>
            {record.printedPercentage !== undefined ? (
              <strong>{record.printedPercentage}%</strong>
            ) : (
              <span className={styles.textMuted}>N/A</span>
            )}
          </span>
        </div>

        <div className={styles.metaCell}>
          <span className={styles.metaLabel}>Subjects Count:</span>
          <span className={styles.metaValue}>
            <strong>{record.subjects.length}</strong>
          </span>
        </div>

        <div className={styles.metaCell}>
          <span className={styles.metaLabel}>Printed Maximum:</span>
          <span className={styles.metaValue}>
            <span className={styles.textMuted}>N/A</span>
          </span>
        </div>
      </div>

      {/* Main Subject Table */}
      <div className={styles.tableSection}>
        <SubjectTable
          subjects={record.subjects}
          printedTotal={record.printedTotal}
          printedPercentage={record.printedPercentage}
          calculated={calculated}
          loading={loading}
        />
      </div>

      {/* Optional Proportional Marks Visualizer */}
      <div className={styles.barsCollapsible}>
        <button
          type="button"
          className={styles.barsToggleBtn}
          onClick={() => setShowBars((prev) => !prev)}
          aria-expanded={showBars}
          aria-controls="marks-bars-container"
        >
          <span>Proportional Marks Visualizer (Obtained vs Maximum)</span>
          {showBars ? (
            <ChevronUpIcon className={styles.inlineIconSm} />
          ) : (
            <ChevronDownIcon className={styles.inlineIconSm} />
          )}
        </button>

        {showBars ? (
          <div id="marks-bars-container" className={styles.barsContainer}>
            <MarksBars subjects={record.subjects} />
          </div>
        ) : null}
      </div>
    </Panel>
  );
}