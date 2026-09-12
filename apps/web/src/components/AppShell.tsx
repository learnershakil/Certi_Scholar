'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, post } from '@/lib/api';
import { dateTime, ROLE_LABEL } from '@/lib/format';
import type { Me, Role } from '@/lib/types';

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;

const NAV: Array<{ section: string; items: Array<{ href: string; label: string; roles: Role[] }> }> = [
  {
    section: 'Work',
    items: [
      { href: '/documents', label: 'My documents', roles: ['student'] },
      { href: '/applications', label: 'My applications', roles: ['student'] },
      { href: '/review', label: 'Review queue', roles: ['verifier', 'admin'] },
      { href: '/documents', label: 'Documents', roles: ['verifier', 'scholarship_officer', 'admin'] },
      { href: '/applications', label: 'Applications', roles: ['scholarship_officer', 'admin'] },
      { href: '/reports', label: 'Reports', roles: ['scholarship_officer', 'admin'] },
    ],
  },
  {
    section: 'Administration',
    items: [
      { href: '/admin/scholarships', label: 'Scholarships & rules', roles: ['admin'] },
      { href: '/admin/settings', label: 'Settings & profiles', roles: ['admin'] },
      { href: '/admin/users', label: 'Users & access', roles: ['admin'] },
      { href: '/admin/audit', label: 'Audit log', roles: ['admin'] },
    ],
  },
];

export const HOME: Record<Role, string> = { student: '/documents', verifier: '/review', scholarship_officer: '/applications', admin: '/admin/scholarships' };

function Notifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Array<{ _id: string; message: string; createdAt: string; readAt?: string; link?: string }>>([]);
  useEffect(() => {
    const load = () => api<typeof items>('/auth/me/notifications').then(setItems).catch(() => undefined);
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <div style={{ position: 'relative' }}>
      <button
        className="btn btn-sm"
        onClick={() => {
          setOpen(!open);
          if (!open && unread) void post('/auth/me/notifications/read').then(() => setItems(items.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))));
        }}
      >
        Notifications{unread ? ` (${unread})` : ''}
      </button>
      {open && (
        <div className="card notif-panel">
          {items.length === 0 && <div className="empty">No notifications</div>}
          {items.map((n) => (
            <div key={n._id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
              <div>{n.link ? <Link href={n.link} onClick={() => setOpen(false)}>{n.message}</Link> : n.message}</div>
              <div className="small faint">{dateTime(n.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    api<Me>('/auth/me').then(setMe).catch(() => router.replace(`/login?next=${encodeURIComponent(pathname)}`));
  }, [router, pathname]);

  if (!me) return <div className="empty">Loading…</div>;

  return (
    <MeContext.Provider value={me}>
      <div className="shell">
        <nav className="sidebar" aria-label="Main">
          <div className="brand">
            <span className="brand-mark">CS</span> CertiScholar
          </div>
          {NAV.map((s) => {
            const items = s.items.filter((i) => i.roles.includes(me.role));
            if (!items.length) return null;
            return (
              <div key={s.section}>
                <div className="nav-section">{s.section}</div>
                {items.map((i) => (
                  <Link key={i.label} href={i.href} className={`nav-link${pathname.startsWith(i.href) ? ' active' : ''}`}>
                    {i.label}
                  </Link>
                ))}
              </div>
            );
          })}
          <div className="sidebar-foot">Extraction and consistency assessment. Authenticity only from issuing authorities.</div>
        </nav>
        <div className="main">
          <header className="topbar">
            <span className="muted">{ROLE_LABEL[me.role]}</span>
            <div className="row">
              <Notifications />
              <span>{me.name}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => post('/auth/logout').then(() => router.replace('/login'))}>
                Sign out
              </button>
            </div>
          </header>
          <main className="content">{children}</main>
        </div>
      </div>
    </MeContext.Provider>
  );
}
