/**
 * Rate-limit classification tests.  Run: npm test
 *
 * A 429 is two failures sharing a status code. Backing off over the one that
 * will not clear until tomorrow cost 45 seconds of a visitor's time on the
 * live site before this existed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDailyQuotaError } from '../src/lib/quota.ts';

test('a per-day free-tier quota is not worth retrying', () => {
  assert.equal(
    isDailyQuotaError(
      'HTTP 429: {"error":{"code":429,"message":"You exceeded your current quota",' +
        '"details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}}'
    ),
    true
  );
});

test('a per-minute rate limit is worth retrying', () => {
  assert.equal(
    isDailyQuotaError(
      'HTTP 429: {"error":{"code":429,"details":[{"quotaId":' +
        '"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}}'
    ),
    false
  );
});

test('spacing and hyphenation in the quota id do not matter', () => {
  for (const s of ['limit: per day', 'PerDay', 'per-day', 'Per Day']) {
    assert.equal(isDailyQuotaError(s), true, s);
  }
});

test('an unrelated 429 body is treated as retryable', () => {
  assert.equal(isDailyQuotaError('HTTP 429: too many requests, slow down'), false);
});

test('a 500 body is not mistaken for a quota error', () => {
  assert.equal(isDailyQuotaError('HTTP 503: model overloaded, try again'), false);
});
