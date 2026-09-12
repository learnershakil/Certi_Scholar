'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { HOME } from '@/components/AppShell';
import type { Me } from '@/lib/types';

export default function Index() {
  const router = useRouter();
  useEffect(() => {
    api<Me>('/auth/me')
      .then((me) => router.replace(HOME[me.role]))
      .catch(() => router.replace('/login'));
  }, [router]);
  return null;
}
