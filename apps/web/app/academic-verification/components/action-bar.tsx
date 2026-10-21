"use client";

import { useState } from "react";
import type { RecordEnvelope } from "../../../lib/academic/types";
import shell from "../shell.module.css";
import styles from "../workbench.module.css";
import { cx } from "./cx";
import {
  ArrowPathIcon,
  PlayIcon,
  PrinterIcon,
  RotateCcwIcon,
  XMarkIcon,
} from "./icons";

interface ActionBarProps {
  envelope: RecordEnvelope | undefined;
  samples: readonly RecordEnvelope[];
  pendingSampleId: string;
  loading: boolean;
  onChooseSample: (id: string) => void;
  onLoadSample: () => void;
  onRun: () => void;
  onReset: () => void;
}

export function ActionBar({
  envelope,
  samples,
  pendingSampleId,
  loading,
  onChooseSample,
  onLoadSample,
  onRun,
  onReset,
}: ActionBarProps) {
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const handlePrint = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  return (
    <section className={shell.actionCard} aria-label="Workbench actions">
      <div className={shell.actionCardTop}>
        {/* Sample selector group */}
        <div className={shell.selectorGroup}>
          <label htmlFor="sample-select" className={shell.fieldLabel}>
            Select Demonstration Sample:
          </label>
          <div className={shell.selectRow}>
            <select
              id="sample-select"
              className={shell.select}
              value={pendingSampleId}
              onChange={(e) => onChooseSample(e.target.value)}
            >
              {samples.map((sample) => (
                <option key={sample.id} value={sample.id}>
                  {sample.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              className={cx(shell.button, shell.buttonSecondary)}
              onClick={onLoadSample}
              disabled={loading}
              title="Load the chosen sample into the verification workspace"
            >
              Load Sample
            </button>
          </div>
        </div>

        {/* Primary and secondary action buttons */}
        <div className={shell.actionButtonGroup}>
          <button
            type="button"
            className={cx(shell.button, shell.buttonPrimary)}
            onClick={onRun}
            disabled={!envelope || loading}
            aria-busy={loading}
            title={
              envelope
                ? "Execute consistency and arithmetic check"
                : "Load a record first to run check"
            }
          >
            {loading ? (
              <>
                <ArrowPathIcon className={shell.spinIcon} />
                <span>Checking Record…</span>
              </>
            ) : (
              <>
                <PlayIcon />
                <span>Run Consistency Check</span>
              </>
            )}
          </button>

          {envelope ? (
            <button
              type="button"
              className={cx(shell.button, shell.buttonOutline)}
              onClick={handlePrint}
              title="Print or export verification audit report"
            >
              <PrinterIcon />
              <span>Print Report</span>
            </button>
          ) : null}

          <button
            type="button"
            className={cx(shell.button, shell.buttonGhost)}
            onClick={() => setConfirmResetOpen(true)}
            disabled={!envelope || loading}
            title="Reset workspace and clear current record"
          >
            <RotateCcwIcon />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Active record summary ribbon */}
      <div className={shell.recordRibbon}>
        <div className={shell.ribbonItem}>
          <span className={shell.ribbonLabel}>Loaded Record:</span>
          {envelope ? (
            <span className={shell.ribbonTitle}>{envelope.label}</span>
          ) : (
            <span className={shell.ribbonEmpty}>None</span>
          )}
        </div>

        {envelope ? (
          <>
            <div className={shell.ribbonItem}>
              <span className={shell.ribbonLabel}>Reference:</span>
              <code className={shell.ribbonCode}>{envelope.id}</code>
            </div>
            <div className={shell.ribbonItem}>
              <span className={shell.ribbonLabel}>Data Origin:</span>
              <span className={styles.sourceTag}>
                {envelope.source === "demo"
                  ? "Synthetic Sample"
                  : "Upstream Pipeline"}
              </span>
            </div>
          </>
        ) : null}
      </div>

      {/* Reset confirmation modal */}
      {confirmResetOpen ? (
        <div
          className={shell.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-modal-title"
        >
          <div className={shell.modalCard}>
            <div className={shell.modalHeader}>
              <h3 id="reset-modal-title" className={shell.modalTitle}>
                Confirm Workspace Reset
              </h3>
              <button
                type="button"
                className={shell.modalCloseBtn}
                onClick={() => setConfirmResetOpen(false)}
                aria-label="Close dialog"
              >
                <XMarkIcon />
              </button>
            </div>
            <div className={shell.modalBody}>
              <p>
                Are you sure you want to reset the current workspace?
              </p>
            </div>
            <div className={shell.modalFooter}>
              <button
                type="button"
                className={cx(shell.button, shell.buttonSecondary)}
                onClick={() => setConfirmResetOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={cx(shell.button, shell.buttonDanger)}
                onClick={() => {
                  setConfirmResetOpen(false);
                  onReset();
                }}
              >
                Reset Workspace
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
