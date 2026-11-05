import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/components/AppShell', () => ({ useMe: () => ({ id: 'u1', name: 'Ananya Sharma', email: 's@example.test', role: 'student' }) }));

import Dashboard from '@/app/(app)/dashboard/page';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const cond = (label: string, fact: string, outcome: string, actual?: unknown) => ({ type: 'condition', label, fact, outcome, actual, reason: '' });

const overview = [
  {
    _id: 's1', code: 'GSTEM-2026', name: 'Women in STEM Scholarship 2026', sponsor: 'Alumni Endowment Fund', amount: 75000,
    description: 'For women students in science.', requiredDocuments: ['marksheet', 'identity'], ruleVersion: 1,
    criteria: {
      type: 'group', op: 'AND', label: 'Women in STEM eligibility', outcome: 'fail', reason: '',
      children: [
        cond('Gender equals female', 'applicant.gender', 'pass', 'female'),
        cond('Annual family income (INR) is at most 800000', 'income.annualIncome', 'pass', 240000),
        cond('Aggregate percentage is at least 75', 'marksheet.percentage', 'unknown'),
        { type: 'group', op: 'OR', label: 'Any of', outcome: 'unknown', reason: '', children: [cond('State of domicile is one of Kerala, Goa', 'applicant.state', 'fail', 'Karnataka')] },
      ],
    },
  },
  { _id: 's2', code: 'MCM-2026', name: 'Merit-cum-Means Scholarship 2026', amount: 50000, requiredDocuments: ['marksheet'], ruleVersion: null, criteria: null },
];

const fetchMock = vi.fn(async (url: string) => {
  if (url.endsWith('/scholarships/overview')) return json(overview);
  if (url.endsWith('/documents')) return json([{ id: 'd1', status: 'processed', documentType: 'marksheet' }, { id: 'd2', status: 'needs_review', documentType: 'income_certificate' }]);
  if (url.endsWith('/applications')) return json([{ _id: 'a1', status: 'under_review', scholarship: { _id: 's2', name: 'Merit-cum-Means Scholarship 2026' } }]);
  throw new Error(`unexpected ${url}`);
});

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('student dashboard', () => {
  it('lists every available scholarship with award, documents uploaded and eligibility', async () => {
    render(<Dashboard />);
    const row = await screen.findByRole('row', { name: 'Women in STEM Scholarship 2026' });
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 scholarships
    expect(within(row).getByText('₹75,000')).toBeTruthy();
    expect(within(row).getByText('1 of 2 uploaded').closest('td')!.getAttribute('title')).toBe('Missing: Identity');
    expect(within(row).getByText('1 of 4 not met')).toBeTruthy();
    expect(screen.getByText('Documents uploaded').nextSibling!.textContent).toBe('2');
    expect(screen.queryByRole('dialog')).toBeNull(); // details open only on request
  });

  it('opens a dialog with the scholarship’s details and criteria when its row is clicked', async () => {
    render(<Dashboard />);
    await userEvent.click(await screen.findByRole('row', { name: 'Women in STEM Scholarship 2026' }));
    const dialog = screen.getByRole('dialog', { name: 'Women in STEM Scholarship 2026' });
    expect(within(dialog).getByText('For women students in science.')).toBeTruthy();
    expect(within(dialog).getByText('Identity').closest('li')!.textContent).toContain('Not uploaded yet');
    const row = (text: string) => within(dialog).getByText(text).closest('li')!;
    expect(within(row('Gender equals female')).getByText('Met')).toBeTruthy();
    expect(within(row('Annual family income (INR) is at most 800000')).getByText('Yours: 2,40,000')).toBeTruthy();
    expect(within(row('State of domicile is one of Kerala, Goa')).getByText('Not met')).toBeTruthy();
    expect(within(row('State of domicile is one of Kerala, Goa')).getByText('Yours: Karnataka')).toBeTruthy();
    expect(within(row('Aggregate percentage is at least 75')).getByText('Awaiting documents')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Apply for this scholarship' }).getAttribute('href')).toBe('/applications?scholarship=s1');
  });

  it('closes with Escape or the close button, and links to an existing application instead of Apply', async () => {
    render(<Dashboard />);
    const card = await screen.findByRole('row', { name: 'Merit-cum-Means Scholarship 2026' });
    await userEvent.click(within(card).getByRole('button', { name: 'Details for Merit-cum-Means Scholarship 2026' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: /View my application/ }).getAttribute('href')).toBe('/applications/a1');
    expect(within(dialog).getByText('Criteria have not been published yet.')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(card);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
