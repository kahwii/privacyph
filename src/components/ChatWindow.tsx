'use client';

import { useState } from 'react';

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

const EXAMPLES = [
  'We were breached yesterday and 300 customer records were exposed. What do we have to do?',
  'Do we need to register our data processing system with the NPC?',
  'We have CCTV in the office. What are the requirements?',
  'Do we always need consent to process personal data?',
];

export default function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function ask(question: string) {
    if (!question.trim() || loading) return;

    setMessages((m) => [...m, { role: 'user', content: question }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();

      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content:
            data.answer ??
            (data.error
              ? `Could not answer — ${data.error}. Check the dev server log for detail.`
              : 'Could not answer. Check the dev server log for detail.'),
          citations: data.citations,
          confidence: data.confidence,
          refused: data.refused,
          insufficient: data.insufficient,
          degraded: data.degraded,
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: 'Could not reach the server. Is the dev server still running?' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="thread">
        {messages.length === 0 && (
          <div className="msg assistant">
            <div className="role">Try asking</div>
            {EXAMPLES.map((q) => (
              <p key={q}>
                <a
                  className="cite"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    ask(q);
                  }}
                >
                  {q}
                </a>
              </p>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="role">{m.role === 'user' ? 'You' : 'PrivacyPH'}</div>
            <p>{m.content}</p>

            {m.citations && m.citations.length > 0 && (
              <div className="citations">
                <div className="label">Sources</div>
                {m.citations.map((c) => (
                  <a
                    key={`${c.shortCode}-${c.section}`}
                    className="cite"
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {c.shortCode}, {c.section} — {c.title}
                  </a>
                ))}
              </div>
            )}

            {m.role === 'assistant' && m.confidence !== undefined && (
              <div className="meta">
                retrieval confidence {m.confidence}
                {m.refused && ' · below retrieval floor, nothing sent to the model'}
                {!m.refused && m.insufficient && ' · retrieved, but the model found no answer in it'}
                {m.degraded && ' · model unavailable, showing source text'}
                <span className="feedback">
                  <button type="button" aria-label="helpful">
                    &#43;
                  </button>
                  <button type="button" aria-label="not helpful">
                    &minus;
                  </button>
                </span>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="msg assistant">
            <div className="role">PrivacyPH</div>
            <p>Searching the corpus…</p>
          </div>
        )}
      </div>

      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
          placeholder="Ask about Data Privacy Act compliance…"
        />
        <button type="button" onClick={() => ask(input)} disabled={loading}>
          Send
        </button>
      </div>
    </>
  );
}
