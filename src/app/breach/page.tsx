import BreachWizard from '@/components/BreachWizard';

export default function BreachPage() {
  return (
    <main className="shell">
      <nav className="tabs">
        <a href="/">Ask</a>
        <a href="/breach">Breach check</a>
      </nav>

      <h1>Breach notification check</h1>
      <p className="sub">
        Works through the three-element notification test and the timing rules under
        RA 10173 Sec. 20, its IRR Rule IX Sec. 38, and NPC Circular 16-03.
      </p>

      <div className="banner">
        General information only, not legal advice. The notification deadline is short
        and the consequences of missing it are real — confirm the result with your DPO
        or counsel. Do not enter the actual personal data of affected individuals here;
        describe the categories only.
      </div>

      <BreachWizard />
    </main>
  );
}
