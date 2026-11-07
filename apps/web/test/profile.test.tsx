import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const me = { id: 'u1', name: 'Ananya Sharma', email: 'student@example.test', role: 'student' as string };
const reloadMe = vi.fn().mockResolvedValue(undefined);
const replace = vi.fn();
vi.mock('@/components/AppShell', () => ({ useMe: () => me, useReloadMe: () => reloadMe, HOME: { student: '/dashboard', verifier: '/review' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

import ProfilePage from '@/app/(app)/profile/page';
import { BrandingProvider } from '@/lib/branding';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn();

function route(profile: object) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/auth/me/profile') && init?.method === 'PATCH') return json({ ...profile, ...JSON.parse(String(init.body)) });
    if (url.endsWith('/auth/me/profile')) return json(profile);
    if (url.endsWith('/scholarships/facts')) {
      return json({ facts: { 'applicant.gender': { type: 'enum', label: 'Gender', options: ['female', 'male'] }, 'applicant.state': { type: 'string', label: 'State of domicile' } } });
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
  replace.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('profile page', () => {
  it('welcomes a new student, takes name, parents’ names, gender and state once, then opens their start page', async () => {
    me.role = 'student';
    route({ ...me, name: null, profile: {}, profileComplete: false });
    renderPage();
    expect(await screen.findByText(/add your name, your parents' names, gender and state of domicile/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Category')).toBeNull(); // no longer collected
    const gender = await screen.findByLabelText('Gender');
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toContain('female'));
    expect(screen.getByText(/only a verification officer or administrator can change them/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Full name (as on your documents)'), 'Ananya Sharma');
    await userEvent.type(screen.getByLabelText("Father's name"), 'Rajesh Sharma');
    await userEvent.type(screen.getByLabelText("Mother's name"), 'Sunita Sharma');
    await userEvent.selectOptions(gender, 'female');
    await userEvent.type(screen.getByLabelText('State of domicile'), 'Kerala');
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(patchCall![1].body)).toEqual({
      name: 'Ananya Sharma',
      profile: { phone: '', fatherName: 'Rajesh Sharma', motherName: 'Sunita Sharma', gender: 'female', state: 'Kerala' },
    });
    expect(reloadMe).toHaveBeenCalled();
  });

  it('shows a student’s details read-only once set, and only sends the phone afterwards', async () => {
    me.role = 'student';
    route({ ...me, profile: { fatherName: 'Rajesh Sharma', motherName: 'Sunita Sharma', gender: 'female', state: 'Karnataka' }, profileComplete: true });
    renderPage();
    for (const label of ['Full name (as on your documents)', "Father's name", "Mother's name", 'Gender']) {
      expect(await screen.findByLabelText<HTMLInputElement>(label)).toBeDisabled();
    }
    expect(await screen.findByLabelText<HTMLInputElement>('State of domicile')).toBeDisabled(); // label comes from the rule catalog
    expect(screen.getByText(/Only a verification officer or administrator can change them/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText<HTMLInputElement>('Role').value).toBe('Student');

    await userEvent.type(screen.getByLabelText('Phone'), '+91 90000 00000');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(patchCall![1].body)).toEqual({ profile: { phone: '+91 90000 00000' } });
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows staff no applicant details', async () => {
    me.role = 'verifier';
    route({ ...me, role: 'verifier', profile: {}, profileComplete: true });
    renderPage();
    expect(await screen.findByLabelText('Full name')).toBeInTheDocument();
    expect(screen.queryByText('Applicant details')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Role').value).toBe('Verification officer');
  });

  it('enables password change only when the new passwords match', async () => {
    me.role = 'verifier';
    route({ ...me, role: 'verifier', profile: {}, profileComplete: true });
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
