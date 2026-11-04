import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';
import { BrandingProvider } from '@/lib/branding';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <BrandingProvider>{children}</BrandingProvider>
      </body>
    </html>
  );
}
