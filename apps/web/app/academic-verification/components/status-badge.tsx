import type { ReactNode } from "react";
import type { EngineStatus } from "../../../lib/academic/types";
import styles from "../workbench.module.css";
import { cx } from "./cx";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
} from "./icons";

export type BadgeStatus = EngineStatus | "NOT_CHECKED";

interface StatusBadgeProps {
  status: BadgeStatus;
  /** Replaces the default text, e.g. "Checking…". */
  label?: string;
  /** Marks the status as belonging to a previous record. */
  stale?: boolean;
  size?: "sm" | "md" | "lg";
}

const CONFIG: Record<
  BadgeStatus,
  {
    text: string;
    Icon: (props: { className?: string }) => ReactNode;
    className: string | undefined;
  }
> = {
  CONSISTENT: {
    text: "CONSISTENT",
    Icon: (props) => <CheckCircleIcon {...props} />,
    className: styles.badgeConsistent,
  },
  INCONSISTENT: {
    text: "INCONSISTENT",
    Icon: (props) => <XCircleIcon {...props} />,
    className: styles.badgeInconsistent,
  },
  NEEDS_REVIEW: {
    text: "NEEDS_REVIEW",
    Icon: (props) => <AlertTriangleIcon {...props} />,
    className: styles.badgeNeedsReview,
  },
  NOT_CHECKED: {
    text: "Not checked yet",
    Icon: (props) => <ClockIcon {...props} />,
    className: styles.badgeNeutral,
  },
};

/**
 * Displays the authoritative engine status word accompanied by an accessible icon.
 * Ensures color is never the sole visual signal.
 */
export function StatusBadge({
  status,
  label,
  stale = false,
  size = "md",
}: StatusBadgeProps) {
  const config = CONFIG[status];
  const text = label ?? config.text;
  const IconComponent = config.Icon;

  return (
    <span
      className={cx(
        styles.badge,
        config.className,
        size === "sm" && styles.badgeSm,
        size === "lg" && styles.badgeLg,
        stale && styles.badgeStale,
      )}
    >
      <span className={styles.badgeIcon} aria-hidden="true">
        <IconComponent />
      </span>
      <span>{stale ? `${text} (stale)` : text}</span>
    </span>
  );
}