import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/components/AppShell', () => ({ useMe: () => ({ id: 'v1', name: 'Rahul', email: 'v@example.test', role: 'verifier' }), useDocTypes: () => [] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { Pagination, ProfileFlag } from '@/components/ui';
import DocumentsPage from '@/app/(app)/documents/page';

afterEach(cleanup);

describe('Pagination', () => {
  it('shows the range, nearby pages with gaps, and moves between pages', async () => {
    const setPage = vi.fn();
    render(<Pagination page={5} pageSize={25} total={300} setPage={setPage} noun="documents" />);
    expect(screen.getByText('101–125 of 300 documents')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Previous', '1', '4', '5', '6', '12', 'Next']);
    expect(screen.getAllByText('…')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Page 5' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Page 12' }));
    expect(setPage.mock.calls).toEqual([[6], [12]]);
  });

  it('only counts when everything fits, and disables the ends', () => {
    const { rerender } = render(<Pagination page={1} pageSize={25} total={7} setPage={() => undefined} noun="students" />);
    expect(screen.getByText('7 students')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<Pagination page={1} pageSize={25} total={30} setPage={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });
});

describe('profile flag', () => {
  it('appears only when the details differ or are unclear', () => {
    const { rerender, container } = render(<ProfileFlag value="match" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ProfileFlag value="mismatch" />);
    expect(screen.getByText('Details differ from profile')).toBeInTheDocument();
    rerender(<ProfileFlag value="unclear" />);
    expect(screen.getByText('Profile check unclear')).toBeInTheDocument();
  });
});

describe('documents list', () => {
  const doc = (n: number, extra = {}) => ({ id: `d${n}`, originalName: `doc-${n}.pdf`, status: 'processed', documentType: 'identity', verification: { status: 'not_verified' }, createdAt: '2026-11-07T10:00:00Z', ...extra });
  const fetchMock = vi.fn(async (url: string) => {
    const page = Number(new URL(url, 'http://x').searchParams.get('page'));
    const items = page === 1 ? [doc(1, { status: 'needs_review', profileMatch: 'mismatch' }), doc(2, { profileMatch: 'match' })] : [doc(26)];
    return new Response(JSON.stringify(items), { status: 200, headers: { 'X-Total-Count': '26' } });
  });
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => vi.unstubAllGlobals());

  it('flags a document whose details differ, and pages through the list', async () => {
    render(<DocumentsPage />);
    const row = (await screen.findByText('doc-1.pdf')).closest('tr')!;
    expect(row.textContent).toContain('Details differ from profile');
    expect(screen.getByText('doc-2.pdf').closest('tr')!.textContent).not.toContain('Details differ');
    expect(screen.getByText('1–25 of 26 documents')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('doc-26.pdf')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('26–26 of 26 documents')).toBeInTheDocument());
    expect(fetchMock.mock.calls.at(-1)![0]).toContain('/documents?page=2&pageSize=25');
  });
});
