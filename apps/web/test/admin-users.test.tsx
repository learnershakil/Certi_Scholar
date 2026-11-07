import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/components/AppShell', () => ({ useMe: () => ({ id: 'a1', name: 'Priya', email: 'admin@example.test', role: 'admin' }) }));

import UsersPage from '@/app/(app)/admin/users/page';
import StudentsPage from '@/app/(app)/students/page';
import { BrandingProvider } from '@/lib/branding';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const calls = () => fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET').map(([url, init]) => [String(url).replace(/^.*\/api\/v1/, ''), init!.method, JSON.parse(String(init!.body))]);
const fetchMock = vi.fn();

const withBranding = (ui: React.ReactNode) =>
  render(<BrandingProvider initial={{ branding: {}, roleLabels: { student: 'Student', verifier: 'Verification officer', scholarship_officer: 'Scholarship officer', admin: 'Administrator' } }}>{ui}</BrandingProvider>);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('admin: users', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.split('?')[0].endsWith('/admin/users') && init?.method === 'POST') return json({ id: 'n1' }, 201);
      if (url.split('?')[0].endsWith('/admin/users')) return json([{ _id: 'u1', name: null, email: 'new@example.test', role: 'student', active: true }]);
      if (url.split('?')[0].endsWith('/admin/users/import')) {
        const { dryRun } = JSON.parse(String(init!.body));
        return json({
          dryRun,
          summary: dryRun ? { ready: 1, created: 0, skipped: 0, invalid: 1 } : { ready: 0, created: 1, skipped: 0, invalid: 1 },
          rows: [
            { line: 2, email: 'one@example.test', outcome: dryRun ? 'ready' : 'created', role: 'student' },
            { line: 3, email: 'bad', outcome: 'invalid', reason: 'Enter a valid email address' },
          ],
        });
      }
      throw new Error(`unexpected ${url}`);
    });
  });

  it('creates an account from an email and an initial password only', async () => {
    withBranding(<UsersPage />);
    expect(await screen.findByText('Not signed in yet')).toBeInTheDocument();
    expect(screen.queryByLabelText('Full name')).toBeNull();
    await userEvent.type(screen.getByLabelText('Email'), 'kavya@example.test');
    await userEvent.type(screen.getByLabelText('Initial password'), 'Initial#Pass2026');
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }));
    await waitFor(() => expect(calls()).toEqual([['/admin/users', 'POST', { email: 'kavya@example.test', role: 'student', password: 'Initial#Pass2026' }]]));
    expect(await screen.findByText(/They add their name when they first sign in/)).toBeInTheDocument();
  });

  it('previews a CSV and creates only after confirmation', async () => {
    withBranding(<UsersPage />);
    const csv = 'email,password,role\none@example.test,Initial#Pass2026,student\nbad,Initial#Pass2026,student\n';
    fireEvent.change(await screen.findByLabelText('CSV file'), { target: { files: [new File([csv], 'users.csv', { type: 'text/csv' })] } });
    expect(await screen.findByText(/Preview: 1 ready to create, 0 already exist, 1 with problems/)).toBeInTheDocument();
    expect(screen.getByText(/Enter a valid email address/)).toBeInTheDocument();
    expect(calls()).toEqual([['/admin/users/import', 'POST', { csv, dryRun: true }]]);

    await userEvent.click(screen.getByRole('button', { name: 'Create 1 account' }));
    expect(await screen.findByText(/Imported: 1 created/)).toBeInTheDocument();
    expect(calls()[1]).toEqual(['/admin/users/import', 'POST', { csv, dryRun: false }]);
  });
});

describe('students: correcting details', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/students/s1') && init?.method === 'PATCH') return json({});
      if (url.includes('/students')) return json([{ id: 's1', email: 'ananya@example.test', name: 'Ananya Sharma', active: true, profile: { fatherName: 'Rajesh Sharma', motherName: 'Sunita Sharma', gender: 'female', state: 'Karnataka' }, profileComplete: true }]);
      if (url.split('?')[0].endsWith('/scholarships/facts')) return json({ facts: { 'applicant.gender': { type: 'enum', label: 'Gender', options: ['female', 'male', 'other'] } } });
      throw new Error(`unexpected ${url}`);
    });
  });

  it('sends only the changed details with the reason', async () => {
    render(<StudentsPage />);
    const row = (await screen.findByText('Ananya Sharma')).closest('tr')!;
    expect(within(row).getByText('Rajesh Sharma')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Edit details for Ananya Sharma' }));

    const dialog = screen.getByRole('dialog', { name: 'Correct student details' });
    const father = within(dialog).getByLabelText("Father's name");
    await userEvent.clear(father);
    await userEvent.type(father, 'Rajesh K Sharma');
    const save = within(dialog).getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled(); // a reason is required
    await userEvent.type(within(dialog).getByLabelText('Reason for the change'), 'Matches the board certificate');
    await userEvent.click(save);
    await waitFor(() => expect(calls()).toEqual([['/students/s1', 'PATCH', { profile: { fatherName: 'Rajesh K Sharma' }, reason: 'Matches the board certificate' }]]));
  });
});
