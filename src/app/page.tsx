import ChatWindow from '@/components/ChatWindow';

export default function Home() {
  return (
    <main className="shell">
      <nav className="tabs">
        <a href="/">Ask</a>
        <a href="/breach">Breach check</a>
      </nav>

      <h1>PrivacyPH</h1>
      <p className="sub">
        Data Privacy Act compliance assistant — grounded on RA 10173, its IRR, and
        current NPC issuances.
      </p>

      <div className="banner">
        General information only, not legal advice. Answers are drawn from the text of
        the issuances cited and may not reflect the latest amendments. Confirm anything
        consequential with your DPO or counsel. Do not enter other people&apos;s personal
        data here.
      </div>

      <ChatWindow />
    </main>
  );
}
