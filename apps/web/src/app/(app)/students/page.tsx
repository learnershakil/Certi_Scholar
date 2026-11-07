'use client';

import { useCallback, useState } from 'react';
import { patch } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { usePaged } from '@/lib/usePaged';
import type { FactDefinition } from '@/lib/types';
import { Card, Empty, ErrorText, Loading, Modal, PageHead, Pagination, StatusPill } from '@/components/ui';

interface Student {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
  profile: { fatherName?: string; motherName?: string; gender?: string; state?: string; phone?: string };
  profileComplete: boolean;
}

const FIELDS = [
  { key: 'name', label: 'Full name' },
  { key: 'fatherName', label: "Father's name" },
  { key: 'motherName', label: "Mother's name" },
  { key: 'gender', label: 'Gender' },
  { key: 'state', label: 'State of domicile' },
] as const;
type Key = (typeof FIELDS)[number]['key'];
const valueOf = (s: Student, k: Key) => (k === 'name' ? s.name : s.profile[k]) ?? '';

/** Changes a student's applicant details with a reason; the student is told and their documents are re-checked. */
function EditStudent({ student, genders, onClose, onSaved }: { student: Student; genders: string[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Record<Key, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, valueOf(student, f.key)])) as Record<Key, string>);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const changed = FIELDS.filter((f) => form[f.key].trim() && form[f.key].trim() !== valueOf(student, f.key));

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const profile = Object.fromEntries(changed.filter((f) => f.key !== 'name').map((f) => [f.key, form[f.key].trim()]));
      const name = changed.some((f) => f.key === 'name') ? form.name.trim() : undefined;
      await patch(`/students/${student.id}`, { ...(name && { name }), profile, reason: reason.trim() });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Correct student details"
      subtitle={student.email}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !changed.length || reason.trim().length < 5} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>Students cannot change these themselves. The change and your reason are recorded, the student is notified, and their documents are matched again.</p>
      <div className="grid grid-2">
        {FIELDS.map((f) => (
          <div className="form-row" key={f.key}>
            <label className="label" htmlFor={`edit-${f.key}`}>{f.label}</label>
            {f.key === 'gender' ? (
              <select id={`edit-${f.key}`} className="select" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="" disabled>Select…</option>
                {genders.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            ) : (
              <input id={`edit-${f.key}`} className="input" value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      <label className="label" htmlFor="edit-reason">Reason for the change</label>
      <textarea id="edit-reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Spelling corrected to match the board certificate" maxLength={500} />
      <ErrorText error={error} />
    </Modal>
  );
}

export default function StudentsPage() {
  const [q, setQ] = useState('');
  const list = usePaged<Student>(`/students${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
  const facts = useApi<{ facts: Record<string, FactDefinition> }>('/scholarships/facts');
  const [editing, setEditing] = useState<Student>();
  const close = useCallback(() => setEditing(undefined), []);

  return (
    <>
      <PageHead
        title="Students"
        subtitle="Applicant details that documents are checked against. Only verification officers and administrators can change them."
        actions={<input className="input" style={{ width: 260 }} placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search students" />}
      />
      <ErrorText error={list.error} />
      <Card flush>
        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.length ? (
          <Empty>No students found.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Student</th><th>Father&apos;s name</th><th>Mother&apos;s name</th><th>Gender</th><th>State</th><th>Profile</th><th /></tr></thead>
              <tbody>
                {list.data.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name || <span className="faint">Not given</span>}<div className="small faint">{s.email}</div></td>
                    <td>{s.profile.fatherName || <span className="faint">—</span>}</td>
                    <td>{s.profile.motherName || <span className="faint">—</span>}</td>
                    <td>{s.profile.gender || <span className="faint">—</span>}</td>
                    <td>{s.profile.state || <span className="faint">—</span>}</td>
                    <td><StatusPill status={s.profileComplete ? 'pass' : 'warning'} tone={s.profileComplete ? 'success' : 'warning'} label={s.profileComplete ? 'Complete' : 'Incomplete'} /></td>
                    <td className="right"><button className="btn btn-sm" onClick={() => setEditing(s)} aria-label={`Edit details for ${s.name || s.email}`}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} setPage={list.setPage} noun="students" />
      </Card>
      {editing && (
        <EditStudent
          student={editing}
          genders={facts.data?.facts['applicant.gender']?.options ?? ['female', 'male', 'other']}
          onClose={close}
          onSaved={() => {
            close();
            void list.reload();
          }}
        />
      )}
    </>
  );
}
