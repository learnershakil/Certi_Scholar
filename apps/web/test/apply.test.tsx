import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/components/AppShell', () => ({ useMe: () => ({ id: 'u1', name: 'Ananya Sharma', email: 's@example.test', role: 'student' }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import ApplicationsPage from '@/app/(app)/applications/page';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const scholarships = [{ _id: 's1', code: 'MCM-2026', name: 'Merit-cum-Means Scholarship 2026', amount: 50000, requiredDocuments: ['marksheet', 'income_certificate'], active: true }];
let documents: object[];
const posted: unknown[] = [];

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.endsWith('/scholarships')) return json(scholarships);
  if (url.endsWith('/documents')) return json(documents);
  if (url.includes('/applications') && init?.method === 'POST') {
    posted.push(JSON.parse(String(init.body)));
    return json({ _id: 'a1' }, 201);
  }
  if (url.includes('/applications')) return json([]);
  throw new Error(`unexpected ${url}`);
});

beforeEach(() => {
  posted.length = 0;
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const choose = async () => {
  render(<ApplicationsPage />);
  await screen.findByRole('option', { name: 'Merit-cum-Means Scholarship 2026' });
  await userEvent.selectOptions(screen.getByLabelText('Scholarship'), 's1');
};

describe('apply form', () => {
  it('blocks submitting until every required document is attached, and says which is missing', async () => {
    documents = [{ id: 'd1', originalName: 'marks.png', status: 'processed', documentType: 'marksheet' }];
    await choose();
    const list = screen.getByRole('list', { name: 'Required documents' });
    expect(within(list).getByText('Marksheet').closest('li')!.textContent).toContain('Attached'); // newest of each type is attached for you
    expect(within(list).getByText('Income certificate').closest('li')!.textContent).toContain('Not uploaded');
    expect(screen.getByRole('button', { name: 'Submit application' })).toBeDisabled();
    expect(screen.getByRole('status').textContent).toMatch(/Attach Income certificate to apply/);
  });

  it('submits once all required documents are attached', async () => {
    documents = [
      { id: 'd2', originalName: 'income.pdf', status: 'processed', documentType: 'income_certificate' },
      { id: 'd1', originalName: 'marks.png', status: 'processed', documentType: 'marksheet' },
    ];
    await choose();
    const submit = screen.getByRole('button', { name: 'Submit application' });
    await waitFor(() => expect(submit).toBeEnabled());

    await userEvent.click(screen.getByRole('checkbox', { name: /income\.pdf/ })); // unticking a required one blocks it again
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /income\.pdf/ }));
    await userEvent.click(submit);
    await waitFor(() => expect(posted).toEqual([{ scholarshipId: 's1', documentIds: ['d1', 'd2'] }]));
  });
});
