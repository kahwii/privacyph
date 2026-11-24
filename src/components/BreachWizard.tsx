'use client';

import { useState } from 'react';

const CATEGORIES = [
  { id: 'sensitive_personal', label: 'Sensitive personal information — health, government IDs, and the rest of Sec. 3(l)' },
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
  const [knownAt, setKnownAt] = useState(() => {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  });
  const [org, setOrg] = useState({ orgName: '', dpoName: '', dpoEmail: '', dpoPhone: '' });

  const [result, setResult] = useState<{ assessment: Assessment; draft: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  function toggle(id: string) {
    setCategories((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  async function submit() {
    setLoading(true);
    setCopied(false);
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

  const a = result?.assessment;

  return (
    <>
      <div className="form-grid">
        <div>
          <fieldset>
            <legend>What data was involved</legend>
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
          </fieldset>

          <fieldset>
            <legend>Circumstances</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={unauthorizedAcquisition}
                onChange={(e) => setUnauth(e.target.checked)}
              />
              There is reason to believe an unauthorised person acquired the data
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
              <label htmlFor="count">Data subjects affected, approximately</label>
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
                When you knew, or had reason to believe, this happened
              </label>
              <input
                id="known"
                type="datetime-local"
                value={knownAt}
                onChange={(e) => setKnownAt(e.target.value)}
              />
            </div>
          </fieldset>

          <fieldset>
            <legend>For the draft notification — optional</legend>
            {([
              ['orgName', 'Organisation'],
              ['dpoName', 'Data Protection Officer'],
              ['dpoEmail', 'DPO email'],
              ['dpoPhone', 'DPO telephone'],
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
          </fieldset>

          <button
            type="button"
            className="primary"
            onClick={submit}
            disabled={loading || categories.length === 0}
          >
            {loading ? 'Checking' : 'Check the duty to notify'}
          </button>
        </div>

        <aside className="index">
          <h2>How this is decided</h2>
          <ol>
            <li>
              Notification turns on three elements, all of which must hold.
              <code> NPC-16-03, Sec. 17</code>
            </li>
            <li style={{ marginTop: 10 }}>
              The window is 72 hours from knowledge or reasonable belief — not from
              confirmation. <code>IRR-10173, Rule IX, Sec. 38</code>
            </li>
            <li style={{ marginTop: 10 }}>
              Notifying the Commission and notifying the data subjects are separate
              obligations.
            </li>
          </ol>
        </aside>
      </div>

      {a && (
        <section className="verdict">
          <h2 className="verdict-head">
            {a.notifiable
              ? 'Notification appears to be required'
              : 'Notification does not appear to be required'}
          </h2>

          {a.deadline && (
            <>
              <p className="deadline">
                {new Date(a.deadline).toLocaleString('en-PH', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
              <p className="deadline-sub">
                {a.hoursRemaining !== null && a.hoursRemaining > 0
                  ? `${a.hoursRemaining} hours left. `
                  : 'This deadline has passed. '}
                Both the National Privacy Commission and the affected data subjects,
                via the {a.submissionChannel}.
              </p>
            </>
          )}

          {a.noDelayReasons.length > 0 && (
            <div className="no-delay">
              <p>
                <strong>No postponement is available on these facts.</strong>
              </p>
              {a.noDelayReasons.map((r) => (
                <p key={r}>{r}</p>
              ))}
            </div>
          )}

          <h3 className="section">The three-element test</h3>
          <ul className="test">
            {a.test.map((t) => (
              <li key={t.citation.section} className={t.satisfied ? 'met' : 'unmet'}>
                <span className="mark">{t.satisfied ? '✓' : '—'}</span>
                <span>
                  {t.label}
                  <span className="cite">
                    {t.citation.shortCode}, {t.citation.section}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <h3 className="section">What follows</h3>
          <ul className="notes">
            {a.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>

          {result?.draft && (
            <>
              <h3 className="section">Draft notification</h3>
              <pre className="draft">{result.draft}</pre>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  navigator.clipboard?.writeText(result.draft!);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy draft'}
              </button>
            </>
          )}
        </section>
      )}
    </>
  );
}
