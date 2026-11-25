'use client';

import { useState, useRef, useEffect, Fragment } from 'react';

interface Citation {
  shortCode: string;
  section: string;
  title: string;
  url: string;
  similarity: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  confidence?: number;
  refused?: boolean;
  insufficient?: boolean;
  degraded?: boolean;
}

interface Starter {
  q: string;
  why: string;
}

/**
 * Starters double as a statement of scope: each one names a different area of
 * the corpus, so the opening screen tells you what the tool knows without a
 * paragraph explaining it.
 */
const STARTERS: Starter[] = [
  {
    q: 'We were breached yesterday and 300 customer records were exposed. What do we have to do?',
    why: 'Breach management — deadlines and who must be told',
  },
  {
    q: 'Do we always need consent to process personal data?',
    why: 'Lawful bases, consent and legitimate interest',
  },
  {
    q: 'We have CCTV in the office. What are the requirements?',
    why: 'CCTV systems',
  },
  {
    q: 'Do we need to register our data processing system with the NPC?',
    why: 'Registration, DPO designation and the NPC seal',
  },
];

/** Matches an inline citation the model emits, e.g. [NPC-16-03, Sec. 18]. */
const CITATION = /\[([A-Z0-9-]+(?:-[A-Z0-9]+)*),\s*([^\]]+)\]/g;

/**
 * Renders the answer with its citations marked.
 *
 * The citation is the only thing this tool has that a general assistant does
 * not, so it is set apart in the text rather than left as bracketed noise the
 * eye slides over.
 */
function Answer({ text }: { text: string }) {
  return (
    <div className="answer">
      {text.split(/\n{2,}/).map((block, bi) => {
        const lines = block.split('\n');
        const quoted = lines.every((l) => /^\s*>\s?/.test(l)) && lines.length > 0;
        const bulleted = lines.every((l) => /^\s*[-*]\s+/.test(l)) && lines.length > 0;

        if (quoted) {
          const [head, ...rest] = lines.map((l) => l.replace(/^\s*>\s?/, ''));
          return (
            <blockquote key={bi}>
              {marked(head)}
              <p>{rest.join(' ')}</p>
            </blockquote>
          );
        }

        if (bulleted) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{marked(l.replace(/^\s*[-*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        return <p key={bi}>{marked(block)}</p>;
      })}
    </div>
  );
}

function marked(text: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  CITATION.lastIndex = 0;

  while ((m = CITATION.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span className="ref" key={`${m.index}-${m[1]}`}>
        {m[1]}, {m[2]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.map((n, i) => <Fragment key={i}>{n}</Fragment>);
}

export default function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // Index of the assistant message being re-asked, or null. A 503 from the
  // generation models is transient -- Google sheds free-tier load when the
  // models are busy -- so the useful thing to offer is one click, not a
  // retyped question.
  const [retrying, setRetrying] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  async function request(question: string): Promise<Message> {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      return {
        role: 'assistant',
        content:
          data.answer ?? data.error ?? 'No answer came back. The server log will say why.',
        citations: data.citations,
        confidence: data.confidence,
        refused: data.refused,
        insufficient: data.insufficient,
        degraded: data.degraded,
      };
    } catch {
      return {
        role: 'assistant',
        content: 'Could not reach the server. Check your connection and try again.',
      };
    }
  }

  async function retry(question: string, index: number) {
    if (retrying !== null || loading) return;
    setRetrying(index);
    const answer = await request(question);
    setMessages((m) => m.map((msg, i) => (i === index ? answer : msg)));
    setRetrying(null);
  }

  async function ask(question: string) {
    if (!question.trim() || loading) return;

    setMessages((m) => [...m, { role: 'user', content: question }]);
    setInput('');
    setLoading(true);

    const answer = await request(question);
    setMessages((m) => [...m, answer]);
    setLoading(false);
    boxRef.current?.focus();
  }

  const turns: { question: string; answer?: Message; answerIndex: number }[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') {
      turns.push({ question: messages[i].content, answer: messages[i + 1], answerIndex: i + 1 });
    }
  }

  return (
    <>
      {messages.length === 0 && (
        <div className="starters">
          {STARTERS.map((s) => (
            <button key={s.q} type="button" className="starter" onClick={() => ask(s.q)}>
              {s.q}
              <span>{s.why}</span>
            </button>
          ))}
        </div>
      )}

      <div className="thread">
        {turns.map((t, i) => (
          <article className="turn" key={i}>
            <h2 className="asked">{t.question}</h2>

            <div>
              {t.answer ? <Answer text={t.answer.content} /> : null}
              {!t.answer && loading && <p className="working">Searching the corpus…</p>}
            </div>

            <aside className="authorities">
              {t.answer?.citations && t.answer.citations.length > 0 && (
                <>
                  <h3>Authorities</h3>
                  {t.answer.citations.map((c) => (
                    <a
                      key={`${c.shortCode}-${c.section}`}
                      className="authority"
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="code">{c.shortCode}</span>
                      <span className="where">
                        {c.section} — {c.title}
                      </span>
                    </a>
                  ))}
                </>
              )}

              {t.answer?.confidence !== undefined && (
                <p className="meta">
                  retrieval <b>{t.answer.confidence}</b>
                  {t.answer.refused && !t.answer.insufficient && ' · below floor, nothing sent to the model'}
                  {t.answer.insufficient && ' · retrieved, no answer found in it'}
                  {t.answer.degraded && ' · summariser busy, showing source text'}
                  {t.answer.degraded && (
                    <button
                      type="button"
                      className="retry"
                      onClick={() => retry(t.question, t.answerIndex)}
                      disabled={retrying !== null || loading}
                    >
                      {retrying === t.answerIndex ? 'Trying…' : 'Try again'}
                    </button>
                  )}
                  <span className="vote">
                    <button type="button" aria-label="This was useful">
                      Useful
                    </button>
                    <button type="button" aria-label="This was not useful">
                      Not useful
                    </button>
                  </span>
                </p>
              )}
            </aside>
          </article>
        ))}

        {loading && turns[turns.length - 1]?.answer && (
          <p className="working">Searching the corpus…</p>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <div className="composer-inner">
          <textarea
            ref={boxRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            placeholder="Ask about Data Privacy Act compliance…"
            aria-label="Your question"
          />
          <button
            type="button"
            className="send"
            onClick={() => ask(input)}
            disabled={loading || !input.trim()}
          >
            {loading ? 'Searching' : 'Ask'}
          </button>
        </div>
      </div>
    </>
  );
}
