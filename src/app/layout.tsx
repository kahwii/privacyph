import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PrivacyPH — Data Privacy Act Compliance Assistant',
  description:
    'Grounded answers on RA 10173 and NPC issuances for Philippine small and medium businesses.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
