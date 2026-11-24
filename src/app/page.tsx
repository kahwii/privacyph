import Masthead from '@/components/Masthead';
import ChatWindow from '@/components/ChatWindow';
import corpus from '../../docs/corpus.json';

interface Entry {
  shortCode: string;
  title: string;
  isCurrent?: boolean;
}

export default function Home() {
  const current = (corpus as Entry[]).filter((d) => d.isCurrent !== false);

  return (
    <>
      <Masthead corpusCount={current.length} />

      <main className="page">
        <div className="page-intro">
          <h1>What does the law actually require?</h1>
          <p>
            Answers drawn from RA 10173, its implementing rules, and the NPC issuances
            currently in force — each one citing the section it came from.
          </p>
          <p className="notice">
            General information, not legal advice. Confirm anything consequential with
            your Data Protection Officer or counsel. Do not enter other people&apos;s
            personal data here.
          </p>
        </div>

        <div className="opening">
          <ChatWindow />

          {/* The corpus is the product. Showing it is more useful than
              describing it, and it sets expectations before the first question
              rather than after a disappointing answer. */}
          <aside className="index">
            <h2>What this reads</h2>
            <ol>
              {current.map((d) => (
                <li key={d.shortCode}>
                  <code>{d.shortCode}</code>
                  <br />
                  {d.title.length > 72 ? `${d.title.slice(0, 72)}…` : d.title}
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </main>
    </>
  );
}
