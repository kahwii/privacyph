import { serviceClient } from './supabase';
import { embed } from './llm';

export interface RetrievedChunk {
  chunk_id: string;
  content: string;
  section_label: string;
  heading: string | null;
  short_code: string;
  doc_title: string;
  source_url: string;
  similarity: number;
}

export async function retrieve(question: string): Promise<RetrievedChunk[]> {
  const embedding = await embed(question, 'RETRIEVAL_QUERY');
  const db = serviceClient();

  const { data, error } = await db.rpc('match_chunks', {
    query_embedding: embedding,
    match_count: Number(process.env.RETRIEVAL_TOP_K ?? 8),
    min_similarity: Number(process.env.MIN_SIMILARITY ?? 0.35),
  });

  if (error) throw new Error(`Retrieval failed: ${error.message}`);
  return (data ?? []) as RetrievedChunk[];
}

/** Keyword boost for citation-style queries ("what does Sec. 18 say"). */
export function rerank(question: string, chunks: RetrievedChunk[]): RetrievedChunk[] {
  const sectionRef = question.match(/sec(?:tion|\.)?\s*(\d+)/i)?.[1];
  const codeRef = question.match(/\b(\d{2}-\d{2}|20\d{2}-\d{2}|10173)\b/)?.[1];

  return [...chunks].sort((a, b) => score(b) - score(a));

  function score(c: RetrievedChunk): number {
    let s = c.similarity;
    if (sectionRef && c.section_label.includes(sectionRef)) s += 0.15;
    if (codeRef && c.short_code.includes(codeRef)) s += 0.1;
    return s;
  }
}

export interface Supersession {
  short_code: string;
  title: string;
  superseded_by: string;
}

let cache: { at: number; rows: Supersession[] } | null = null;
const CACHE_MS = 10 * 60 * 1000;

/**
 * The issuances that have been replaced, and what replaced them.
 *
 * match_chunks filters superseded documents out of retrieval, which is right
 * for "what are the rules" but wrong for "is the 2020 advisory still in
 * force" — that question can only be answered by the very rows the filter
 * removes. The relationship lives in the documents table and was never
 * reaching the model, so the system held the answer and could not say it.
 *
 * It is three rows and it changes about once a year, so it is cached and
 * passed with every prompt rather than queried per question.
 */
export async function supersessions(): Promise<Supersession[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;

  const db = serviceClient();
  const { data, error } = await db
    .from('documents')
    .select('short_code, title, superseded_by')
    .eq('is_current', false)
    .not('superseded_by', 'is', null);

  if (error) {
    console.warn('[retrieval] could not load supersessions:', error.message);
    return cache?.rows ?? [];
  }

  cache = { at: Date.now(), rows: (data ?? []) as Supersession[] };
  return cache.rows;
}
