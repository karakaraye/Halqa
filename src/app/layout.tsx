import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Halqa — Closing the Screening-to-Care Loop',
  description: 'Every actionable screening result communicated, confirmed, converted into timely care, owned at every step, and closed with evidence.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
