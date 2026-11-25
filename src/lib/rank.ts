/**
 * Post-retrieval reranking. Kept in its own module with no runtime imports so
 * it can be unit-tested: retrieval.ts pulls in the Supabase and LLM clients,
 * which the node test runner cannot load.
 */
import type { RetrievedChunk } from './retrieval';

/**
 * Every Philippine issuance closes with the same formalities, and they are
 * indexed like any other section: 55 of the corpus's 548 chunks are headed
 * Effectivity, Separability, Repealing or Transitory. Asked what to do about a
 * breach affecting 300 customers, retrieval returned NPC-16-03's effectivity
 * clause and signature block in third place -- "This Order shall take effect
 * fifteen (15) days after publication... Approved: (Sgd.)". Correct issuance,
 * useless section.
 *
 * The benchmark did not catch this, and could not: it asks whether the
 * governing issuance appears, not whether the chunk that came back answers
 * anything. It showed up by reading the live site.
 *
 * Only Effectivity and Separability are penalised. A repealing clause bears on
 * what is still in force, and transitory provisions routinely carry real
 * compliance deadlines -- demoting those would trade one blind spot for
 * another. And if the question is itself about commencement, the penalty is
 * dropped, because then the clause is the answer.
 */
const BOILERPLATE = /^\s*(effectivity|separability|severability)\b/i;
const ASKS_ABOUT_COMMENCEMENT = /\b(effectiv|take effect|took effect|in force|commence)/i;

/** Keyword boost for citation-style queries ("what does Sec. 18 say"). */
export function rerank(question: string, chunks: RetrievedChunk[]): RetrievedChunk[] {
  const sectionRef = question.match(/sec(?:tion|\.)?\s*(\d+)/i)?.[1];
  const codeRef = question.match(/\b(\d{2}-\d{2}|20\d{2}-\d{2}|10173)\b/)?.[1];
  const wantsCommencement = ASKS_ABOUT_COMMENCEMENT.test(question);

  return [...chunks].sort((a, b) => score(b) - score(a));

  function score(c: RetrievedChunk): number {
    let s = c.similarity;
    if (sectionRef && c.section_label.includes(sectionRef)) s += 0.15;
    if (codeRef && c.short_code.includes(codeRef)) s += 0.1;
    if (!wantsCommencement && BOILERPLATE.test(c.heading ?? '')) s -= 0.15;
    return s;
  }
}
