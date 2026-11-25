import type { RetrievedChunk, Supersession } from './retrieval';

export const SYSTEM_PROMPT = `You are a Philippine data privacy compliance assistant for small and medium businesses.

ABSOLUTE RULES
1. Answer ONLY from the CONTEXT below. If the context does not contain the answer, say you do not have it and point the user to the National Privacy Commission (privacy.gov.ph). Never fill a gap from general knowledge.
2. Cite the source for every substantive statement, inline, in the form [SHORT_CODE, Section]. Example: [NPC-16-03, Sec. 18]. Use ONLY the exact Section label shown in the CONTEXT block you are citing. Copy it as written.
3. Never invent a section number, a deadline, a penalty amount, or a citation. If the context gives a range or a condition, reproduce the condition.
3a. The context has NO page numbers and NO summaries. Never write "Page 12", "Summary", "Overview" or anything similar inside a citation — if it is not a Section label from the context, it does not belong in the brackets.
4. This is general information, not legal advice. Do not tell the user what they are legally required to do in their specific case — tell them what the issuance says and recommend they confirm with their DPO or counsel for anything consequential.
5. Always answer in English, whatever language the question is written in. The corpus is in English, the citations are in English, and a mixed-language answer is harder to check against the source.
6. Be concrete and short. Lead with the direct answer, then the conditions and exceptions.
7. Plain text only. No markdown: no ###, no **bold**, no tables. For a list, start each line with "- ". The answer is rendered as plain text, so markup shows up as literal characters.
8. If the CONTEXT does not answer the question, reply with exactly INSUFFICIENT_CONTEXT on the first line, then one sentence pointing to the National Privacy Commission. Do not cite anything in that case — citing sources that do not answer the question implies they do.
9. A REPEALED ISSUANCES list may appear above the context. If the question asks whether something is still in force, answer from that list: say it was repealed and name what replaced it. That is an answer, not a gap — do not reply INSUFFICIENT_CONTEXT for it.

If the user pastes real personal data of other people, do not repeat it back; remind them not to put personal data into this tool.`;

export function buildUserPrompt(
  question: string,
  chunks: RetrievedChunk[],
  superseded: Supersession[] = []
): string {
  const context = chunks
    .map(
      (c, i) =>
        `--- CONTEXT ${i + 1} ---\n` +
        `Source: ${c.short_code} (${c.doc_title})\n` +
        `Section: ${c.section_label}${c.heading ? ` — ${c.heading}` : ''}\n\n` +
        c.content.trim()
    )
    .join('\n\n');

  // Retrieval only returns issuances still in force, so without this note
  // the model cannot tell the difference between "repealed" and "absent".
  const status = superseded.length
    ? 'REPEALED ISSUANCES (not in the context above, and no longer in force):\n' +
      superseded
        .map((s) => `- ${s.short_code} (${s.title}) was replaced by ${s.superseded_by}`)
        .join('\n') +
      '\n\nEvery issuance quoted in CONTEXT is currently in force.\n\n'
    : '';

  return `${status}CONTEXT\n${context}\n\nQUESTION\n${question}`;
}

export const REFUSAL =
  'I do not have a solid basis in the corpus to answer this accurately. ' +
  'Rather than guess, I would point you to the National Privacy Commission ' +
  '(privacy.gov.ph) or a data privacy practitioner for this one.';

/**
 * Conversational filler — greetings, thanks, acknowledgements.
 *
 * A retrieval system has nothing useful to say about "thanks", and running the
 * full pipeline on it is three mistakes at once: it spends a request against a
 * rate-limited quota, it risks a model error on a message that needed no
 * model, and when retrieval inevitably finds nothing it answers a courtesy
 * with a refusal about the National Privacy Commission.
 */
const FILLER =
  '(hi|hello|hey|yo|good (morning|afternoon|evening)|kumusta|kamusta|' +
  'salamat|thanks|thank you|thx|ty|ok|okay|okey|sige|alright|' +
  'got it|noted|nice|great|cool|awesome|perfect|bye|goodbye|paalam|po)';

/**
 * Matches a message made up ENTIRELY of filler, one word or several, so
 * "thanks" and "okay thanks po" both qualify while "okay, but what about
 * CCTV?" does not — "but" is not filler, and the match must cover the whole
 * string for the short-circuit to fire.
 */
const SMALL_TALK = new RegExp(`^\\s*(${FILLER}[\\s!.,?]*)+$`, 'i');

export function smallTalkReply(question: string): string | null {
  const q = question.trim();
  if (q.length > 40 || !SMALL_TALK.test(q)) return null;

  if (/salamat|thanks|thank you|thx|ty/i.test(q)) {
    return 'Anytime. Ask me anything else about the Data Privacy Act, NPC circulars, or a breach you are handling.';
  }
  if (/bye|goodbye|paalam/i.test(q)) {
    return 'Take care. Come back if a compliance question comes up.';
  }
  if (/^(ok|okay|okey|sige|alright|got it|noted|nice|great|cool|awesome|perfect)/i.test(q)) {
    return 'Let me know if you want to dig into any part of that.';
  }
  return 'Hello. Ask me about Data Privacy Act compliance — consent, breach notification, registration, CCTV, and so on.';
}

/**
 * The answer to give when retrieval worked but every generation model was
 * unavailable.
 *
 * This is the whole argument for keeping retrieval and generation separate.
 * The hard part — finding which provisions govern the question — already
 * succeeded; only the paraphrasing failed. Handing the user the provisions
 * themselves is worth far more than an apology, and on a legal question the
 * source text is arguably the better answer anyway.
 */
export function sourcesOnlyAnswer(chunks: RetrievedChunk[]): string {
  const top = chunks.slice(0, 3);

  const body = top
    .map((c) => {
      const title = c.heading ? `${c.section_label} — ${c.heading}` : c.section_label;
      const text = c.content.replace(/\s+/g, ' ').trim();
      // 320 characters is roughly the opening of a provision: enough to see
      // whether it is the one you need, short enough that three of them do
      // not become a wall. The citation links to the full text.
      const excerpt = text.length > 320 ? `${text.slice(0, 320).trimEnd()}…` : text;
      return `> [${c.short_code}, ${title}]\n> ${excerpt}`;
    })
    .join('\n\n');

  return (
    'The summariser is busy right now, so this answer is not summarised. The ' +
    'search still found the provisions that govern your question — here are ' +
    'their openings, with links to the full text in the margin.\n\n' +
    body +
    '\n\nThis usually clears within a minute. Try again for a summarised answer.'
  );
}

/**
 * The model emits this on the first line when the retrieved context does not
 * answer the question.
 *
 * It exists because the honest refusal and the confident answer looked
 * identical to the server: both were just text, so both got a Sources list
 * attached. Showing four citations under "I do not have the answer" suggests
 * those four sources support something, which is the opposite of true.
 */
export const INSUFFICIENT = 'INSUFFICIENT_CONTEXT';

/**
 * Does the answer actually cite anything?
 *
 * Rule 8 asks the model to prefix a refusal with INSUFFICIENT_CONTEXT so the
 * citation list can be suppressed. The model does not always remember. Asked
 * for the maximum GDPR fine in Germany it declined correctly -- "I do not have
 * the answer to your question" -- and omitted the marker, so four Philippine
 * issuances were about to be rendered underneath as though they supported it.
 *
 * This is the check that cannot be forgotten, because it reads what the model
 * wrote rather than what it was asked to write. Rule 2 requires a citation for
 * every substantive statement, so an answer carrying none is, by the system's
 * own definition, not grounded in the context -- whatever prefix it does or
 * does not have.
 *
 * Known cost: a supersession answer ("the 2020 CCTV advisory was replaced by
 * NPC Circular No. 2024-02") is correct and cites nothing, because it is
 * answered from the repealed-issuances list rather than from a chunk. It
 * loses its sources panel too. That is the conservative direction to fail in
 * -- showing nothing is a smaller error than showing sources that support
 * nothing -- but it is a real loss and not a free win.
 */
const CITATION = /\[[A-Z0-9-]{2,},[^\]]+\]/;

export function citesSomething(answer: string): boolean {
  return CITATION.test(answer);
}

export function stripInsufficientMarker(answer: string): {
  text: string;
  insufficient: boolean;
} {
  const trimmed = answer.trim();
  if (!trimmed.startsWith(INSUFFICIENT)) return { text: trimmed, insufficient: false };
  return {
    text: trimmed.slice(INSUFFICIENT.length).replace(/^[\s:—-]+/, '').trim() || REFUSAL,
    insufficient: true,
  };
}
