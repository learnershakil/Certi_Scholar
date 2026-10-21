"use client";

import { useState } from "react";
import { formatPercentage, formatTimestamp } from "../../../lib/academic/display";
import type { HistoryEntry } from "../../../lib/academic/types";
import panels from "../panels.module.css";
import styles from "../workbench.module.css";
import { HistoryModal } from "./history-modal";
import { ClockIcon, EyeIcon } from "./icons";
import { Panel } from "./panel";
import { StatusBadge } from "./status-badge";

interface SessionHistoryProps {
  entries: readonly HistoryEntry[];
  onLoadRecord?: (recordId: string) => void;
}

export function SessionHistory({ entries, onLoadRecord }: SessionHistoryProps) {
  const [inspectingEntry, setInspectingEntry] = useState<HistoryEntry | null>(
    null,
  );

  return (
    <>
      <Panel id="history" title="Recent Verification Checks">
        {entries.length === 0 ? (
          <div className={panels.emptyHistoryWrap}>
            <ClockIcon className={panels.emptyHistoryIcon} />
            <p className={panels.emptyHistory}>
              No checks recorded in this session.
            </p>
          </div>
        ) : (
          <div
            className={styles.tableWrap}
            role="region"
            aria-label="Recent verification checks this session"
            tabIndex={0}
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Execution Time</th>
                  <th scope="col">Record Reference</th>
                  <th scope="col" className={styles.num}>
                    Subjects
                  </th>
                  <th scope="col" className={styles.num}>
                    Recalculated %
                  </th>
                  <th scope="col">Engine Verdict</th>
                  <th scope="col" className={styles.num}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.key} className={styles.historyRow}>
                    <td className={styles.historyTimeCell}>
                      {formatTimestamp(entry.checkedAt)}
                    </td>
                    <th scope="row" className={styles.historyLabelCell}>
                      <div className={styles.historyLabelMain}>
                        {entry.recordLabel}
                      </div>
                      <code className={styles.historyIdCode}>
                        {entry.recordId}
                      </code>
                    </th>
                    <td className={styles.num}>{entry.subjectCount}</td>
                    <td className={styles.num}>
                      {entry.recalculatedPercentage !== undefined ? (
                        <strong>{formatPercentage(entry.recalculatedPercentage)}</strong>
                      ) : (
                        <span className={styles.textMuted}>—</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={entry.status} size="sm" />
                    </td>
                    <td className={styles.num}>
                      <button
                        type="button"
                        className={styles.viewDetailsBtn}
                        onClick={() => setInspectingEntry(entry)}
                        title={`Inspect check details for ${entry.recordLabel}`}
                      >
                        <EyeIcon className={styles.inlineIconSm} />
                        <span>View Details</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <HistoryModal
        entry={inspectingEntry}
        onClose={() => setInspectingEntry(null)}
        onLoadRecord={onLoadRecord}
      />
    </>
  );
}