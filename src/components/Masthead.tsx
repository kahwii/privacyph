'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

const TABS = [
  { href: '/', label: 'Ask' },
  { href: '/breach', label: 'Breach check' },
];

export default function Masthead({ corpusCount }: { corpusCount: number }) {
  const path = usePathname();

  return (
    <header className="masthead">
      <div className="masthead-inner">
        <Link href="/" className="wordmark">
          PrivacyPH
        </Link>

        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={path === t.href ? 'tab tab-on' : 'tab'}
              aria-current={path === t.href ? 'page' : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <p className="corpus-count">
          {corpusCount} issuances indexed
        </p>
      </div>
    </header>
  );
}
