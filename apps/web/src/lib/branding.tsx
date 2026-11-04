'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { humanize } from './format';

/** Product name and sign-in wording, set by administrators (Admin → Settings) and served by GET /api/v1/branding. */
export interface Branding {
  appName?: string;
  eyebrow?: string;
  headline?: string;
  lead?: string;
  points?: string[];
  footnote?: string;
  passwordHelp?: string;
}

export interface BrandingState {
  branding: Branding;
  roleLabels: Record<string, string>;
}

const BrandingContext = createContext<BrandingState>({ branding: {}, roleLabels: {} });

export const useBranding = () => useContext(BrandingContext);

/** Display name for a role; falls back to the role key when no label is configured. */
export const roleLabel = (labels: Record<string, string>, role: string) => labels[role] || humanize(role);

/** Two-letter mark built from the product name ("CertiScholar" → "CS", "Scholar Desk" → "SD"). */
export const initials = (name = '') => {
  const words = name.match(/[A-Z][a-z]*|[a-z]+|\d+/g) ?? [];
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '·';
};

/** Loads the wording once for the whole app. `initial` skips the request (tests, previews). */
export function BrandingProvider({ children, initial }: { children: ReactNode; initial?: BrandingState }) {
  const [state, setState] = useState<BrandingState | null>(initial ?? null);

  useEffect(() => {
    if (initial) return;
    api<BrandingState>('/branding')
      .then(setState)
      .catch(() => setState({ branding: {}, roleLabels: {} }));
  }, [initial]);

  useEffect(() => {
    if (state?.branding.appName) document.title = state.branding.appName;
  }, [state]);

  if (!state) return null;
  return <BrandingContext.Provider value={state}>{children}</BrandingContext.Provider>;
}
