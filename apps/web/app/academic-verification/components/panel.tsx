import type { ReactNode } from "react";
import styles from "../workbench.module.css";

interface PanelProps {
  /** Unique within the page. Used to link the heading to its section. */
  id: string;
  title: string;
  subtitle?: string;
  /** Optional content aligned to the right of the header. */
  aside?: ReactNode;
  children: ReactNode;
}

export function Panel({ id, title, subtitle, aside, children }: PanelProps) {
  const headingId = `${id}-heading`;

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <header className={styles.panelHeader}>
        <div>
          <h2 id={headingId} className={styles.panelTitle}>
            {title}
          </h2>
          {subtitle ? <p className={styles.panelSubtitle}>{subtitle}</p> : null}
        </div>
        {aside ? <div>{aside}</div> : null}
      </header>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}