import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import { NavProvider } from '@/components/NavProgress';
import { ConfirmProvider } from '@/components/Confirm';
import './globals.css';

export const metadata: Metadata = {
  title: 'UNCAHP — LP Funnel Dashboard',
  description: 'Portfolio overview · Meta Ads × GHL × Bookings',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-screen antialiased">
        <NavProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </NavProvider>
        {/* Every action result (sync, save, archive, delete) lands here. */}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border-strong)',
              color: 'var(--color-fg)',
              fontFamily: 'var(--font-sans)',
            },
          }}
        />
      </body>
    </html>
  );
}
