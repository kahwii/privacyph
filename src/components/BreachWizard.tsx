'use client';

import { useState } from 'react';

const CATEGORIES = [
  { id: 'sensitive_personal', label: 'Sensitive personal information (health, government IDs, etc.)' },
  { id: 'financial', label: 'Financial or economic data' },
  { id: 'credentials', label: 'Usernames, passwords, login data' },
  { id: 'biometric', label: 'Biometric data' },
  { id: 'identity_documents', label: 'Copies of IDs, licenses, unique identifiers' },
  { id: 'basic_contact', label: 'Names and contact details only' },
  { id: 'other', label: 'Other personal information' },
];

interface Assessment {
  notifiable: boolean;
  test: { label: string; satisfied: boolean; citation: { shortCode: string; section: string } }[];
  noDelayPermitted: boolean;
  noDelayReasons: string[];
  deadline: string | null;
  hoursRemaining: number | null;
  notifyParties: string[];
  submissionChannel: string;
  notes: string[];
}

export default function BreachWizard() {
  const [categories, setCategories] = useState<string[]>([]);
  const [unauthorizedAcquisition, setUnauth] = useState(true);
  const [riskOfSeriousHarm, setRisk] = useState(true);
  const [affectedCount, setCount] = useState(0);
  const [knownAt, setKnownAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [org, setOrg] = useState({ orgName: '', dpoName: '', dpoEmail: '', dpoPhone: '' });

  const [result, setResult] = useState<{ assessment: Assessment; draft: string | null } | null>(null);
  const [loading, setLoading] = useState(false);

  function toggle(id: string) {
    setCategories((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  async function submit() {
    setLoading(true);
    try {
      const res = await fetch('/api/breach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categories,
          unauthorizedAcquisition,
          riskOfSeriousHarm,
          affectedCount,
          knownAt: new Date(knownAt).toISOString(),
          ...org,
        }),
      });
      setResult(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2>1. What data was involved?</h2>
        {CATEGORIES.map((c) => (
          <label key={c.id} className="check">
            <input
              type="checkbox"
              checked={categories.includes(c.id)}
              onChange={() => toggle(c.id)}
            />
            {c.label}
          </label>
        ))}
      </section>

      <section className="card">
        <h2>2. Circumstances</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={unauthorizedAcquisition}
            onChange={(e) => setUnauth(e.target.checked)}
          />
          There is reason to believe an unauthorized person acquired the data
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={riskOfSeriousHarm}
            onChange={(e) => setRisk(e.target.checked)}
          />
          The acquisition is likely to give rise to a real risk of serious harm
        </label>

        <div className="field">
          <label htmlFor="count">Approximate number of data subjects affected</label>
          <input
            id="count"
            type="number"
            min={0}
            value={affectedCount}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label htmlFor="known">
            When did you know, or form a reasonable belief, that this happened?
          </label>
          <input
            id="known"
            type="datetime-local"
            value={knownAt}
            onChange={(e) => setKnownAt(e.target.value)}
          />
        </div>
      </section>

      <section className="card">
        <h2>3. For the draft notification (optional)</h2>
        {([
          ['orgName', 'Organization name'],
          ['dpoName', 'DPO name'],
          ['dpoEmail', 'DPO email'],
          ['dpoPhone', 'DPO phone'],
        ] as const).map(([key, label]) => (
          <div className="field" key={key}>
            <label htmlFor={key}>{label}</label>
            <input
              id={key}
              value={org[key]}
              onChange={(e) => setOrg({ ...org, [key]: e.target.value })}
            />
          </div>
        ))}
      </section>

      <button type="button" onClick={submit} disabled={loading || categories.length === 0}>
        {loading ? 'Checking…' : 'Check notification duty'}
      </button>

      {result && (
        <section className={`card verdict ${result.assessment.notifiable ? 'alert' : 'ok'}`}>
          <h2>
            {result.assessment.notifiable
              ? 'Notification appears to be required'
              : 'Notification does not appear to be required'}
          </h2>

          {result.assessment.deadline && (
            <p className="deadline">
              Deadline: {new Date(result.assessment.deadline).toLocaleString('en-PH')}
              {result.assessment.hoursRemaining !== null && (
                <span className="meta">
                  {' '}
                  ({result.assessment.hoursRemaining > 0
                    ? `${result.assessment.hoursRemaining} hours left`
                    : 'already past'})
                </span>
              )}
            </p>
          )}

          <h3>The three-element test</h3>
          <ul className="test">
            {result.assessment.test.map((t) => (
              <li key={t.citation.section} className={t.satisfied ? 'met' : 'unmet'}>
                <span className="mark">{t.satisfied ? '✓' : '✗'}</span>
                {t.label}
                <span className="cite-inline">
                  [{t.citation.shortCode}, {t.citation.section}]
                </span>
              </li>
            ))}
          </ul>

          {result.assessment.noDelayReasons.length > 0 && (
            <>
              <h3>No postponement available</h3>
              <ul>
                {result.assessment.noDelayReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}

          {result.assessment.notifyParties.length > 0 && (
            <p>
              Notify: {result.assessment.notifyParties.join(' and ')} — via the{' '}
              {result.assessment.submissionChannel}.
            </p>
          )}

          <h3>Notes</h3>
          <ul>
            {result.assessment.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>

          {result.draft && (
            <>
              <h3>Draft notification</h3>
              <pre className="draft">{result.draft}</pre>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(result.draft!)}
              >
                Copy draft
              </button>
            </>
          )}
        </section>
      )}
    </>
  );
}
