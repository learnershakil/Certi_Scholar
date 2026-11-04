import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const me = { id: 'u1', name: 'Ananya Sharma', email: 'student@example.test', role: 'student' as string };
const reloadMe = vi.fn().mockResolvedValue(undefined);
vi.mock('@/components/AppShell', () => ({ useMe: () => me, useReloadMe: () => reloadMe }));

import ProfilePage from '@/app/(app)/profile/page';
import { BrandingProvider } from '@/lib/branding';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn();

function route(profile: object) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/auth/me/profile') && init?.method === 'PATCH') return json({ ...profile, ...JSON.parse(String(init.body)) });
    if (url.endsWith('/auth/me/profile')) return json(profile);
    if (url.endsWith('/scholarships/facts')) {
      return json({ facts: { 'applicant.category': { type: 'enum', label: 'Category', options: ['GEN', 'SC', 'ST'] }, 'applicant.gender': { type: 'enum', label: 'Gender', options: ['female', 'male'] }, 'applicant.state': { type: 'string', label: 'State of domicile' } } });
    }
    if (url.endsWith('/auth/me/password')) return new Response(null, { status: 204 });
    throw new Error(`unexpected ${url}`);
  });
}

const renderPage = () =>
  render(
    <BrandingProvider initial={{ branding: {}, roleLabels: { student: 'Student', verifier: 'Verification officer' } }}>
      <ProfilePage />
    </BrandingProvider>,
  );

beforeEach(() => {
  fetchMock.mockReset();
  reloadMe.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('profile page', () => {
  it('lets a student edit applicant details using the rule engine’s choices', async () => {
    me.role = 'student';
    route({ ...me, profile: { category: 'GEN', gender: 'female', state: 'Karnataka' } });
    renderPage();
    const category = await screen.findByLabelText('Category');
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toContain('ST'));
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText<HTMLInputElement>('Role').value).toBe('Student');

    await userEvent.selectOptions(category, 'SC');
    await userEvent.clear(screen.getByLabelText('Full name'));
    await userEvent.type(screen.getByLabelText('Full name'), 'Ananya S.');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(patchCall![1].body)).toEqual({ name: 'Ananya S.', profile: { phone: '', category: 'SC', gender: 'female', state: 'Karnataka' } });
    expect(await screen.findByText(/open applications are being re-checked/)).toBeInTheDocument();
    expect(reloadMe).toHaveBeenCalled();
  });

  it('shows staff no applicant details', async () => {
    me.role = 'verifier';
    route({ ...me, role: 'verifier', profile: {} });
    renderPage();
    expect(await screen.findByLabelText('Full name')).toBeInTheDocument();
    expect(screen.queryByText('Applicant details')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Role').value).toBe('Verification officer');
  });

  it('enables password change only when the new passwords match', async () => {
    me.role = 'verifier';
    route({ ...me, role: 'verifier', profile: {} });
    renderPage();
    await userEvent.type(await screen.findByLabelText('Current password'), 'old-password-1');
    await userEvent.type(screen.getByLabelText('New password'), 'new-password-123');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'new-password-12');
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Confirm new password'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/me/password'));
    expect(JSON.parse(call![1].body)).toEqual({ currentPassword: 'old-password-1', newPassword: 'new-password-123' });
    expect(await screen.findByText('Password changed.')).toBeInTheDocument();
  });
});
