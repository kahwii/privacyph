import Masthead from '@/components/Masthead';
import BreachWizard from '@/components/BreachWizard';
import corpus from '../../../docs/corpus.json';

export default function BreachPage() {
  const count = (corpus as { isCurrent?: boolean }[]).filter(
    (d) => d.isCurrent !== false
  ).length;

  return (
    <>
      <Masthead corpusCount={count} />

      <main className="page">
        <div className="page-intro">
          <h1>Is this breach notifiable, and by when?</h1>
          <p>
            Works through the three-element test and the timing rules in RA 10173
            Sec. 20, IRR Rule IX Sec. 38, and NPC Circular 16-03.
          </p>
          <p className="notice">
            General information, not legal advice. The window is short and the
            consequences of missing it are real — confirm the result with your DPO or
            counsel. Describe the categories of data involved; do not enter the actual
            personal data of the people affected.
          </p>
        </div>

        <BreachWizard />
      </main>
    </>
  );
}
