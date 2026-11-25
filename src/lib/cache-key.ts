import { createHash } from 'node:crypto';

/**
 * Cache keying. No imports but node:crypto, so it can be unit-tested: cache.ts
 * reaches the Supabase client and prompt.ts, neither of which the node test
 * runner can resolve.
 */

/**
 * Two questions are the same question if they differ only in case, spacing or
 * trailing punctuation. Anything beyond that -- synonyms, word order -- is a
 * different question, and treating it as the same one would serve an answer to
 * something nobody asked.
 */
export function normaliseQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?.!\s]+$/, '');
}

/** A short, stable identifier for whatever rules an answer was written under. */
export function versionOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/**
 * The prompt version and the retrieval mode are part of the key, not just the
 * question. An answer written under a different system prompt was written
 * under different rules -- about citation format, about when to refuse -- and
 * serving it later would quietly contradict the rules in force. Changing
 * either misses every existing row instead, and the cache refills itself.
 */
export function fingerprint(question: string, promptVersion: string, mode: string): string {
  return createHash('sha256')
    .update(`${normaliseQuestion(question)}|${promptVersion}|${mode}`)
    .digest('hex');
}
