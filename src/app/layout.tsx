import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Serif } from 'next/font/google';
import './globals.css';

/**
 * Plex was drawn for technical and institutional documentation, which is what
 * this corpus is. The serif carries the answers, because the answers are legal
 * text and should read like it; the sans carries the interface around them.
 * One superfamily keeps the two voices related rather than merely adjacent.
 */
const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

const serif = IBM_Plex_Serif({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PrivacyPH — Data Privacy Act compliance assistant',
  description:
    'Answers on RA 10173 and current NPC issuances for Philippine small and medium businesses, with a citation on every statement.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
