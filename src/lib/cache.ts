import { serviceClient } from './supabase';
import { SYSTEM_PROMPT } from './prompt';
import { fingerprint as hash, versionOf } from './cache-key';

/** Changing the system prompt invalidates every cached answer by design. */
function key(question: string): string {
  return hash(question, versionOf(SYSTEM_PROMPT), process.env.RETRIEVAL_MODE ?? 'dense');
}

export interface CachedAnswer {
  answer: string;
  citations: unknown[];
  confidence: number | null;
  insufficient: boolean;
}

/** Returns a cached answer, or null. Never throws: a cache is an optimisation. */
export async function lookup(question: string): Promise<CachedAnswer | null> {
  try {
    const { data, error } = await serviceClient()
      .from('answer_cache')
      .select('answer, citations, confidence, insufficient, hits')
      .eq('fingerprint', key(question))
      .maybeSingle();

    if (error || !data) return null;

    // Fire and forget. A failed counter update must not delay or fail the
    // answer it is counting.
    void serviceClient()
      .from('answer_cache')
      .update({ hits: (data.hits ?? 0) + 1, last_served_at: new Date().toISOString() })
      .eq('fingerprint', key(question));

    return {
      answer: data.answer,
      citations: (data.citations ?? []) as unknown[],
      confidence: data.confidence,
      insufficient: data.insufficient,
    };
  } catch {
    return null;
  }
}

/**
 * Stores an answer. Call this ONLY for an answer the model actually produced.
 *
 * A degraded answer -- the provisions served verbatim because every generation
 * model was unavailable -- must never be stored. Caching a failure makes it
 * permanent, and the whole purpose of this table is to survive that failure
 * rather than preserve it.
 */
export async function store(
  question: string,
  value: CachedAnswer
): Promise<void> {
  try {
    await serviceClient()
      .from('answer_cache')
      .upsert(
        {
          fingerprint: key(question),
          question: question.trim(),
          answer: value.answer,
          citations: value.citations,
          confidence: value.confidence,
          insufficient: value.insufficient,
        },
        { onConflict: 'fingerprint' }
      );
  } catch {
    // An answer that could not be cached is still an answer.
  }
}
