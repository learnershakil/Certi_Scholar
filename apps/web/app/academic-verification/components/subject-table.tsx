import type { AcademicEngineResult, SubjectMark } from "@repo/academic-engine";
import {
  barFillPercent,
  checkSubjectMarkValidity,
  formatMarks,
  formatPercentage,
  formatSignedDifference,
  printedMinusCalculated,
  subjectPercentage,
} from "../../../lib/academic/display";
import styles from "../workbench.module.css";
import { cx } from "./cx";
import { AlertTriangleIcon, CheckCircleIcon } from "./icons";

interface SubjectTableProps {
  subjects: readonly SubjectMark[];
  printedTotal?: number;
  printedPercentage?: number;
  calculated?: AcademicEngineResult["calculated"];
  loading?: boolean;
}

/**
 * Subject-level academic data table with per-subject engine validation status,
 * proportional score indicators, and summary calculations.
 */
export function SubjectTable({
  subjects,
  printedTotal,
  printedPercentage,
  calculated,
  loading = false,
}: SubjectTableProps) {
  // Sum of subjects marks received
  const sumObtained = subjects.reduce((sum, s) => sum + s.obtained, 0);
  const sumMaximum = subjects.reduce((sum, s) => sum + s.maximum, 0);

  const totalDifference = printedMinusCalculated(
    printedTotal,
    calculated?.totalObtained ?? (sumMaximum > 0 ? sumObtained : undefined),
  );

  return (
    <div
      className={styles.tableWrap}
      role="region"
      aria-label="Subject marks breakdown"
      tabIndex={0}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.colIndex}>
              #
            </th>
            <th scope="col">Subject Name</th>
            <th scope="col" className={styles.num}>
              Marks Obtained
            </th>
            <th scope="col" className={styles.num}>
              Max Marks
            </th>
            <th scope="col" className={styles.colProgress}>
              Score % (Display)
            </th>
            <th scope="col" className={styles.colStatus}>
              Subject Validation
            </th>
          </tr>
        </thead>
        <tbody>
          {subjects.length === 0 ? (
            <tr>
              <td colSpan={6} className={styles.tableEmpty}>
                {loading
                  ? "Loading subject marks…"
                  : "No subjects present in this record."}
              </td>
            </tr>
          ) : (
            subjects.map((mark, index) => {
              const percentage = subjectPercentage(mark);
              const fill = barFillPercent(mark);
              const validity = checkSubjectMarkValidity(mark);

              return (
                <tr
                  key={`${index}-${mark.subject}`}
                  className={!validity.valid ? styles.rowInvalid : undefined}
                >
                  <td className={styles.colIndex}>{index + 1}</td>
                  <th scope="row" className={styles.subjectNameCell}>
                    {mark.subject}
                  </th>
                  <td className={styles.num}>{formatMarks(mark.obtained)}</td>
                  <td className={styles.num}>{formatMarks(mark.maximum)}</td>
                  <td className={styles.colProgress}>
                    <div className={styles.miniScoreContainer}>
                      <span className={styles.miniScoreText}>
                        {percentage === undefined
                          ? "n/a"
                          : formatPercentage(percentage)}
                      </span>
                      <div className={styles.miniBarTrack} aria-hidden="true">
                        <div
                          className={styles.miniBarFill}
                          style={{ width: `${fill}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className={styles.colStatus}>
                    {validity.valid ? (
                      <span className={styles.subStatusValid}>
                        <CheckCircleIcon className={styles.inlineIconSm} />
                        <span>Valid</span>
                      </span>
                    ) : (
                      <span
                        className={styles.subStatusInvalid}
                        title={validity.message}
                      >
                        <AlertTriangleIcon className={styles.inlineIconSm} />
                        <span>{validity.message}</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        {subjects.length > 0 ? (
          <tfoot>
            <tr className={styles.tableTotalRow}>
              <td colSpan={2} className={styles.totalRowLabel}>
                Recalculated Sums:
              </td>
              <td className={styles.num}>
                <strong>{formatMarks(calculated?.totalObtained ?? sumObtained)}</strong>
                {printedTotal !== undefined && totalDifference !== undefined && (
                  <span
                    className={cx(
                      styles.deltaPill,
                      totalDifference === 0 ? styles.deltaMatch : styles.deltaMismatch,
                    )}
                    title={`Printed total: ${printedTotal}`}
                  >
                    {totalDifference === 0
                      ? "Matches printed"
                      : `Diff: ${formatSignedDifference(totalDifference)}`}
                  </span>
                )}
              </td>
              <td className={styles.num}>
                <strong>{formatMarks(calculated?.totalMaximum ?? sumMaximum)}</strong>
              </td>
              <td className={styles.colProgress}>
                {calculated ? (
                  <strong className={styles.totalPercentage}>
                    {formatPercentage(calculated.percentage)}
                  </strong>
                ) : (
                  <span className={styles.textMuted}>
                    {loading ? "Checking…" : "—"}
                  </span>
                )}
              </td>
              <td className={styles.colStatus}>
                <span className={styles.textMuted}>
                  {subjects.length} subjects
                </span>
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}