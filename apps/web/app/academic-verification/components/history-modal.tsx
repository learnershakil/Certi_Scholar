"use client";

import { useEffect, useRef } from "react";
import { formatPercentage, formatTimestamp } from "../../../lib/academic/display";
import type { HistoryEntry } from "../../../lib/academic/types";
import shell from "../shell.module.css";
import styles from "../workbench.module.css";
import { AlertTriangleIcon, CheckCircleIcon, ClockIcon, XMarkIcon } from "./icons";
import { StatusBadge } from "./status-badge";

interface HistoryModalProps {
  entry: HistoryEntry | null;
  onClose: () => void;
  onLoadRecord?: (recordId: string) => void;
}

export function HistoryModal({
  entry,
  onClose,
  onLoadRecord,
}: HistoryModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (entry) {
      closeBtnRef.current?.focus();
    }
  }, [entry]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!entry) return null;

  return (
    <div
      className={shell.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-modal-title"
    >
      <div className={shell.modalCard}>
        <div className={shell.modalHeader}>
          <div className={shell.modalHeaderLeft}>
            <ClockIcon className={shell.modalHeaderIcon} />
            <div>
              <h3 id="history-modal-title" className={shell.modalTitle}>
                Check Details: {entry.recordLabel}
              </h3>
              <p className={shell.modalSubtitle}>
                Timestamp: {formatTimestamp(entry.checkedAt)}
              </p>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className={shell.modalCloseBtn}
            onClick={onClose}
            aria-label="Close dialog"
          >
            <XMarkIcon />
          </button>
        </div>

        <div className={shell.modalBody}>
          <div className={styles.modalMetaGrid}>
            <div className={styles.metaCell}>
              <span className={styles.metaLabel}>Record Identifier</span>
              <span className={styles.metaValue}>
                <code>{entry.recordId}</code>
              </span>
            </div>

            <div className={styles.metaCell}>
              <span className={styles.metaLabel}>Verdict</span>
              <span className={styles.metaValue}>
                <StatusBadge status={entry.status} size="sm" />
              </span>
            </div>

            <div className={styles.metaCell}>
              <span className={styles.metaLabel}>Subjects Evaluated</span>
              <span className={styles.metaValue}>
                <strong>{entry.subjectCount}</strong>
              </span>
            </div>

            <div className={styles.metaCell}>
              <span className={styles.metaLabel}>Recalculated Percentage</span>
              <span className={styles.metaValue}>
                {entry.recalculatedPercentage !== undefined ? (
                  <strong>{formatPercentage(entry.recalculatedPercentage)}</strong>
                ) : (
                  <span className={styles.textMuted}>Not returned</span>
                )}
              </span>
            </div>
          </div>

          <div className={styles.modalIssuesSection}>
            <h4 className={styles.modalIssuesHeading}>
              Engine Issues ({entry.issues.length})
            </h4>
            {entry.issues.length === 0 ? (
              <div className={styles.modalNoIssues}>
                <CheckCircleIcon className={styles.inlineIcon} />
                <span>No issues were flagged for this check.</span>
              </div>
            ) : (
              <ul className={styles.modalIssuesList}>
                {entry.issues.map((issue, idx) => (
                  <li key={`${idx}-${issue}`}>
                    <AlertTriangleIcon className={styles.inlineIconSm} />
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className={shell.modalFooter}>
          {onLoadRecord ? (
            <button
              type="button"
              className={shell.button}
              onClick={() => {
                onLoadRecord(entry.recordId);
                onClose();
              }}
            >
              Load This Record into Workspace
            </button>
          ) : null}
          <button
            type="button"
            className={shell.buttonPrimary}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
