'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, post } from '@/lib/api';
import { dateTime, setDocTypeNames } from '@/lib/format';
import { initials, roleLabel, useBranding } from '@/lib/branding';
import type { DocTypeDef, Me, Role } from '@/lib/types';
import { Icon, type IconName } from './Icon';

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;
const ReloadMeContext = createContext<() => Promise<void>>(async () => undefined);
/** Re-reads the signed-in user, e.g. after they rename themselves on the profile page. */
export const useReloadMe = () => useContext(ReloadMeContext);
const DocTypesContext = createContext<DocTypeDef[]>([]);
/** Active document types from the API, for dropdowns. */
export const useDocTypes = () => useContext(DocTypesContext);

const NAV: Array<{ section: string; items: Array<{ href: string; label: string; icon: IconName; roles: Role[] }> }> = [
  {
    section: 'Work',
    items: [
      { href: '/documents', label: 'My documents', icon: 'file', roles: ['student'] },
      { href: '/applications', label: 'My applications', icon: 'inbox', roles: ['student'] },
      { href: '/review', label: 'Review queue', icon: 'check', roles: ['verifier', 'admin'] },
      { href: '/documents', label: 'Documents', icon: 'file', roles: ['verifier', 'scholarship_officer', 'admin'] },
      { href: '/applications', label: 'Applications', icon: 'inbox', roles: ['scholarship_officer', 'admin'] },
      { href: '/reports', label: 'Reports', icon: 'chart', roles: ['scholarship_officer', 'admin'] },
    ],
  },
  {
    section: 'Administration',
    items: [
      { href: '/admin/scholarships', label: 'Scholarships & rules', icon: 'layers', roles: ['admin'] },
      { href: '/admin/settings', label: 'Settings & profiles', icon: 'sliders', roles: ['admin'] },
      { href: '/admin/users', label: 'Users & access', icon: 'users', roles: ['admin'] },
      { href: '/admin/audit', label: 'Audit log', icon: 'list', roles: ['admin'] },
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
        className="btn btn-ghost btn-sm"
        aria-label="Notifications"
        onClick={() => {
          setOpen(!open);
          if (!open && unread) void post('/auth/me/notifications/read').then(() => setItems(items.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))));
        }}
      >
        <Icon name="bell" />
        {unread ? <span className="pill tone-info">{unread}</span> : null}
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
  const { branding, roleLabels } = useBranding();
  const [me, setMe] = useState<Me | null>(null);
  const [docTypes, setDocTypes] = useState<DocTypeDef[]>([]);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    Promise.all([api<Me>('/auth/me'), api<DocTypeDef[]>('/document-types')])
      .then(([m, types]) => {
        setDocTypeNames(types);
        setDocTypes(types);
        setMe(m);
      })
      .catch(() => router.replace(`/login?next=${encodeURIComponent(pathname)}`));
  }, [router, pathname]);

  const reloadMe = async () => setMe(await api<Me>('/auth/me'));

  if (!me) return <div className="empty">Loading…</div>;
  const current = NAV.flatMap((s) => s.items).find((i) => i.roles.includes(me.role) && pathname.startsWith(i.href));

  return (
    <MeContext.Provider value={me}>
      <ReloadMeContext.Provider value={reloadMe}>
      <DocTypesContext.Provider value={docTypes}>
      <div className="shell">
        <nav className="sidebar" aria-label="Main">
          <div className="brand">
            <span className="brand-mark">{initials(branding.appName)}</span> {branding.appName}
          </div>
          {NAV.map((s) => {
            const items = s.items.filter((i) => i.roles.includes(me.role));
            if (!items.length) return null;
            return (
              <div key={s.section}>
                <div className="nav-section">{s.section}</div>
                {items.map((i) => (
                  <Link key={i.label} href={i.href} className={`nav-link${pathname.startsWith(i.href) ? ' active' : ''}`}>
                    <Icon name={i.icon} />
                    {i.label}
                  </Link>
                ))}
              </div>
            );
          })}
          {branding.footnote && <div className="sidebar-foot">{branding.footnote}</div>}
        </nav>
        <div className="main">
          <header className="topbar">
            <div className="crumb">
              {roleLabel(roleLabels, me.role)}
              <span className="faint">/</span>
              <strong>{current?.label ?? (pathname.startsWith('/profile') ? 'My profile' : branding.appName)}</strong>
            </div>
            <div className="row">
              <Notifications />
              <Link href="/profile" className="user-link" title="My profile">
                <span className="avatar">{me.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                <span className="small">{me.name}</span>
              </Link>
              <button className="btn btn-ghost btn-sm" onClick={() => post('/auth/logout').then(() => router.replace('/login'))}>
                Sign out
              </button>
            </div>
          </header>
          <main className="content">{children}</main>
        </div>
      </div>
      </DocTypesContext.Provider>
      </ReloadMeContext.Provider>
    </MeContext.Provider>
  );
}
