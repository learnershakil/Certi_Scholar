import type { SubjectMark } from "@repo/academic-engine";
import {
  barFillPercent,
  formatMarks,
  formatPercentage,
  subjectPercentage,
} from "../../../lib/academic/display";
import styles from "../workbench.module.css";

interface MarksBarsProps {
  subjects: readonly SubjectMark[];
}

/**
 * Display-only horizontal bars. The numbers are printed beside every bar,
 * so the chart never relies on colour or length alone.
 */
export function MarksBars({ subjects }: MarksBarsProps) {
  const scaleMax = subjects.reduce(
    (largest, mark) => (mark.maximum > largest ? mark.maximum : largest),
    0,
  );

  if (subjects.length === 0) {
    return <p className={styles.chartNote}>No subjects to chart.</p>;
  }

  return (
    <div>
      <ul
        className={styles.bars}
        aria-label="Obtained versus maximum marks by subject"
      >
        {subjects.map((mark, index) => {
          const percentage = subjectPercentage(mark);
          const trackWidth =
            scaleMax > 0 && mark.maximum > 0
              ? (mark.maximum / scaleMax) * 100
              : 0;

          return (
            <li key={`${index}-${mark.subject}`}>
              <div className={styles.barHead}>
                <span className={styles.barName}>{mark.subject}</span>
                <span className={styles.barValues}>
                  {formatMarks(mark.obtained)} / {formatMarks(mark.maximum)}
                  {percentage === undefined
                    ? ""
                    : ` (${formatPercentage(percentage)})`}
                </span>
              </div>
              <div
                className={styles.barTrack}
                style={{ width: `${trackWidth}%` }}
                aria-hidden="true"
              >
                <div
                  className={styles.barFill}
                  style={{ width: `${barFillPercent(mark)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}