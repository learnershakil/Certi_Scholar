import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/login',
}));

import LoginPage from '@/app/login/page';
import { BrandingProvider } from '@/lib/branding';

const BRANDING = {
  branding: { appName: 'Scholar Desk', headline: 'Every decision explained', points: ['First point'], passwordHelp: 'Ask your admin' },
  roleLabels: { student: 'Student', verifier: 'Verification officer', scholarship_officer: 'Scholarship officer', admin: 'Administrator' },
};
const renderLogin = () => render(<BrandingProvider initial={BRANDING}><LoginPage /></BrandingProvider>);

const fetchMock = vi.fn();
beforeEach(() => {
  replace.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const fill = async (role: string) => {
  await userEvent.type(screen.getByPlaceholderText('Email'), 'verifier@certischolar.local');
  await userEvent.type(screen.getByPlaceholderText('Password'), 'test-password-1');
  await userEvent.selectOptions(screen.getByLabelText('Sign in as'), role);
};

describe('login page', () => {
  it('offers the four roles, student first', () => {
    renderLogin();
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Student', 'Verification officer', 'Scholarship officer', 'Administrator']);
    expect(screen.getByLabelText<HTMLSelectElement>('Sign in as').value).toBe('student');
  });

  it('shows and hides the password', async () => {
    renderLogin();
    const input = screen.getByPlaceholderText('Password');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('sends the chosen role and opens that role’s home page', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: '1', name: 'Rahul', email: 'v', role: 'verifier' }), { status: 200 }));
    renderLogin();
    await fill('verifier');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'verifier@certischolar.local', password: 'test-password-1', role: 'verifier' });
    expect(replace).toHaveBeenCalledWith('/review');
  });

  it('shows the server’s message when the role does not match', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'invalid_credentials', message: 'Email, password or role is incorrect' } }), { status: 401 }));
    renderLogin();
    await fill('admin');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email, password or role is incorrect')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('login page wording', () => {
  it('comes from the configured branding', () => {
    renderLogin();
    expect(screen.getAllByText('Scholar Desk').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SD').length).toBeGreaterThan(0); // mark built from the name
    expect(screen.getByText('Every decision explained')).toBeInTheDocument();
    expect(screen.getByText('First point')).toBeInTheDocument();
    expect(screen.getByText('Ask your admin')).toBeInTheDocument();
  });

  it('shows configured role names', () => {
    render(<BrandingProvider initial={{ branding: {}, roleLabels: { student: 'Applicant' } }}><LoginPage /></BrandingProvider>);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Applicant', 'Verifier', 'Scholarship officer', 'Admin']);
  });
});
