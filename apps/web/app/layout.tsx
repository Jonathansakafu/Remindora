import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-grotesk', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Remindora', template: '%s · Remindora' },
  description: 'Capture, plan and focus — tasks, calendar, habits and priority reminders on every device.',
  icons: { icon: '/icon.svg' },
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = { themeColor: '#070D22', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="observatory" className={`${inter.variable} ${grotesk.variable}`} suppressHydrationWarning>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-cyan focus:px-3 focus:py-2 focus:text-[#06122e]">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
