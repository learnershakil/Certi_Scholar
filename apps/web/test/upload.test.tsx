import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/AppShell', () => ({ useMe: () => ({ id: 'u1', name: 'Ananya', email: 's@example.test', role: 'student' }), useDocTypes: () => [] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import DocumentsPage from '@/app/(app)/documents/page';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let uploadResponse: Response;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.split('?')[0].endsWith('/documents/upload-policy')) return json({ maxBytes: 10 * 1024 * 1024, accept: ['application/pdf', 'image/png', 'image/jpeg'] });
  if (url.split('?')[0].endsWith('/documents') && init?.method === 'POST') return uploadResponse;
  if (url.split('?')[0].endsWith('/documents')) return json([{ id: 'd1', originalName: 'wrong.pdf', status: 'rejected', documentType: 'identity', verification: { status: 'not_verified' }, rejection: { reason: 'This is not an identity document.', at: '2026-11-05T10:00:00Z' }, createdAt: '2026-11-05T09:00:00Z' }]);
  throw new Error(`unexpected ${url}`);
});

const file = (name: string, type: string, size: number) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const choose = async (f: File) => {
  render(<DocumentsPage />);
  await screen.findByText('wrong.pdf');
  fireEvent.change(screen.getByLabelText('Choose document'), { target: { files: [f] } });
};
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('upload form', () => {
  it('stops a file over the limit before sending it, giving its size and the limit', async () => {
    await choose(file('CSE408.pdf', 'application/pdf', 66.5 * 1024 * 1024));
    expect(await screen.findByText(/"CSE408\.pdf" is 66\.5 MB\. The limit is 10\.0 MB/)).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('stops a file in an unaccepted format', async () => {
    await choose(file('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 2000));
    expect(await screen.findByText(/"notes\.docx" is not a PDF, PNG or JPEG file/)).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('explains a server failure that came without a message', async () => {
    uploadResponse = new Response('Internal Server Error', { status: 500 });
    await choose(file('marks.pdf', 'application/pdf', 2000));
    expect(await screen.findByText(/The server could not process the upload/)).toBeInTheDocument();
    expect(screen.queryByText('Upload failed')).toBeNull();
  });

  it('shows the server’s own reason when it gives one', async () => {
    uploadResponse = json({ error: { code: 'malware_detected', message: 'The file failed the security scan and was not stored' } }, 422);
    await choose(file('marks.pdf', 'application/pdf', 2000));
    expect(await screen.findByText('The file failed the security scan and was not stored')).toBeInTheDocument();
  });

  it('confirms the virus scan found nothing and the file was stored', async () => {
    uploadResponse = json({ id: 'd9', status: 'queued', originalName: 'marks.pdf', scan: { engine: 'clamav', clean: true } }, 202);
    await choose(file('marks.pdf', 'application/pdf', 2000));
    expect(await screen.findByText(/"marks\.pdf" was scanned by ClamAV: no virus found\. It is stored encrypted/)).toBeInTheDocument();
  });

  it('names the virus when one is found', async () => {
    uploadResponse = json({ error: { code: 'malware_detected', message: 'Virus found in "bad.pdf" (Eicar-Signature). The file was not stored.' } }, 422);
    await choose(file('bad.pdf', 'application/pdf', 2000));
    expect(await screen.findByText('Virus found in "bad.pdf" (Eicar-Signature). The file was not stored.')).toBeInTheDocument();
  });

  it('shows the student why a document was rejected', async () => {
    render(<DocumentsPage />);
    expect(await screen.findByText('This is not an identity document.')).toBeInTheDocument();
  });
});
