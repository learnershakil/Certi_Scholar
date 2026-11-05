import { useEffect, useId, useRef, type ReactNode } from 'react';
import { humanize, STATUS_TONE, type Tone } from '@/lib/format';

/** Centred dialog over a dimmed page. Escape, the close button or a click outside closes it; focus returns to where it was. */
export function Modal({ title, subtitle, onClose, footer, children }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; footer?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
        <header className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <div className="small faint" style={{ marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button className="btn btn-ghost btn-sm modal-close" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function StatusPill({ status, label, tone }: { status: string; label?: string; tone?: Tone }) {
  return <span className={`pill tone-${tone ?? STATUS_TONE[status] ?? 'neutral'}`}>{label ?? humanize(status)}</span>;
}

export function Card({ title, actions, children, flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {flush ? children : <div className="card-body">{children}</div>}
    </section>
  );
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  return (
    <div className={`notice ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function ConfidenceMeter({ value, threshold }: { value: number; threshold: number }) {
  const low = value < threshold;
  return (
    <div className="row" title={`Confidence ${Math.round(value * 100)}% · threshold ${Math.round(threshold * 100)}%`}>
      <div className={`meter${low ? ' low' : ''}`} aria-hidden>
        <span style={{ width: `${Math.round(value * 100)}%` }} />
        <i className="meter-tick" style={{ left: `${threshold * 100}%` }} />
      </div>
      <span className={`small ${low ? '' : 'muted'}`} style={low ? { color: 'var(--danger)' } : undefined}>
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="small faint">{hint}</div>}
    </div>
  );
}

export const ErrorText = ({ error }: { error?: Error | string | null }) =>
  error ? <Notice tone="danger">{typeof error === 'string' ? error : error.message}</Notice> : null;

export const Loading = () => (
  <div className="empty page-loading" role="status">
    <span className="spinner" aria-hidden />
    <span className="sr-only">Loading…</span>
  </div>
);
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
