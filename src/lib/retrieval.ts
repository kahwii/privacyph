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
  /** Position in the dense list, 0 if the lexical side found it alone. */
  dense_rank?: number;
  /** Position in the lexical list, 0 if the dense side found it alone. */
  lexical_rank?: number;
}

/**
 * RETRIEVAL_MODE=hybrid runs dense and lexical search together and fuses the
 * ranks; dense is the original behaviour. Both are kept so the benchmark can
 * be run against either and the difference reported, rather than the change
 * being asserted.
 *
 * Read per call, not once at module scope: static imports are hoisted, so a
 * caller that sets process.env.RETRIEVAL_MODE in its own module body (the
 * eval harness does, from --mode=) would set it after this module had already
 * been evaluated, and the flag would silently do nothing.
 */
function mode(): 'dense' | 'hybrid' {
  return (process.env.RETRIEVAL_MODE ?? 'dense') as 'dense' | 'hybrid';
}

export async function retrieve(question: string): Promise<RetrievedChunk[]> {
  const embedding = await embed(question, 'RETRIEVAL_QUERY');
  const db = serviceClient();

  const matchCount = Number(process.env.RETRIEVAL_TOP_K ?? 8);
  const minSimilarity = Number(process.env.MIN_SIMILARITY ?? 0.35);

  if (mode() === 'hybrid') {
    const { data, error } = await db.rpc('match_chunks_hybrid', {
      query_embedding: embedding,
      query_text: question,
      match_count: matchCount,
      min_similarity: minSimilarity,
    });

    if (!error) return (data ?? []) as RetrievedChunk[];

    // The migration in supabase/hybrid.sql may not have been run yet. Falling
    // back keeps the app working rather than failing on a missing function,
    // and says so once rather than silently behaving differently.
    console.warn(
      `[retrieval] hybrid unavailable (${error.message}); falling back to dense. ` +
        'Run supabase/hybrid.sql to enable it.'
    );
  }

  const { data, error } = await db.rpc('match_chunks', {
    query_embedding: embedding,
    match_count: matchCount,
    min_similarity: minSimilarity,
  });

  if (error) throw new Error(`Retrieval failed: ${error.message}`);
  return (data ?? []) as RetrievedChunk[];
}

export function retrievalMode(): string {
  return mode();
}

export { rerank } from './rank';


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
