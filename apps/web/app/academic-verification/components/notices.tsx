import type { CheckErrorKind } from "../../../lib/academic/types";
import shell from "../shell.module.css";
import { cx } from "./cx";
import { AlertCircleIcon, AlertTriangleIcon, ArrowPathIcon } from "./icons";

// Reusable alert circle
function ErrorIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      width="20"
      height="20"
      {...props}
    >
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

const TITLES: Record<CheckErrorKind, string> = {
  "invalid-request": "Record Schema Validation Rejected",
  server: "Verification Service Error",
  network: "Network Connection Failure",
};

interface ErrorNoticeProps {
  kind: CheckErrorKind;
  message: string;
  details?: readonly string[] | undefined;
  onRetry: () => void;
}

export function ErrorNotice({
  kind,
  message,
  details,
  onRetry,
}: ErrorNoticeProps) {
  // Retrying identical, malformed data would fail the same way.
  const canRetry = kind !== "invalid-request";

  return (
    <div role="alert" className={cx(shell.notice, shell.noticeError)}>
      <div className={shell.noticeContent}>
        <ErrorIcon className={shell.noticeIcon} />
        <div>
          <p className={shell.noticeTitle}>{TITLES[kind]}</p>
          <p className={shell.noticeMsg}>{message}</p>
          {details && details.length > 0 ? (
            <ul className={shell.noticeList}>
              {details.map((detail, index) => (
                <li key={`${index}-${detail}`}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      {canRetry ? (
        <button
          type="button"
          className={cx(shell.button, shell.buttonSecondary)}
          onClick={onRetry}
        >
          <ArrowPathIcon className={shell.inlineIconSm} />
          <span>Retry Check</span>
        </button>
      ) : null}
    </div>
  );
}

export function StaleNotice() {
  return (
    <div role="status" className={cx(shell.notice, shell.noticeStale)}>
      <div className={shell.noticeContent}>
        <AlertTriangleIcon className={shell.noticeIcon} />
        <div>
          <p className={shell.noticeTitle}>Displaying Previous Check Result (Stale)</p>
          <p className={shell.noticeMsg}>
            A different sample record was loaded into the workspace. The metrics and
            reconciliation above correspond to the previously checked record. Run the
            consistency check to verify the current record.
          </p>
        </div>
      </div>
    </div>
  );
}