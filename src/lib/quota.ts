/**
 * Does this 429 body describe a daily quota rather than a per-minute limit?
 *
 * Gemini names the quota it refused on, and the identifier carries the window:
 * GenerateRequestsPerDayPerProjectPerModel-FreeTier against
 * ...PerMinute... . Matching the window rather than the prose keeps this from
 * turning on a sentence Google is free to reword.
 *
 * Quota is per model, so a model that is out does not mean the next one is --
 * the chain still moves on. What it skips is the backoff, which cannot help.
 */
export function isDailyQuotaError(body: string): boolean {
  return /per\s*-?\s*day/i.test(body);
}
