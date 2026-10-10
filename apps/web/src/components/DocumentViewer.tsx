'use client';

import type { ExtractedField } from '@/lib/types';

/**
 * Document image with every extracted field's source region overlaid. Boxes are stored normalised
 * (0–1), so they are positioned as percentages and stay aligned at any zoom level.
 */
export function DocumentViewer({
  src,
  fields,
  activeKey,
  onSelect,
  page = 0,
}: {
  src?: string;
  fields: ExtractedField[];
  activeKey?: string | null;
  onSelect: (key: string) => void;
  page?: number;
}) {
  if (!src) return <div className="viewer empty">Preview unavailable</div>;
  return (
    <div className="viewer" aria-label="Document preview">
      <div className="viewer-page">
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, must not be cached or optimised */}
        <img src={src} alt="Uploaded document" />
        {fields
          .filter((f) => f.bbox && f.page === page)
          .map((f) => {
            const [x0, y0, x1, y1] = f.bbox!;
            const low = f.status === 'needs_review';
            return (
              <button
                key={f.key}
                type="button"
                data-testid={`bbox-${f.key}`}
                className={`bbox${low ? ' low' : ''}${activeKey === f.key ? ' active' : ''}`}
                style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}
                title={`${f.label}: ${f.value ?? 'not read'}`}
                aria-label={`Highlight ${f.label}`}
                onClick={() => onSelect(f.key)}
              />
            );
          })}
      </div>
    </div>
  );
}
