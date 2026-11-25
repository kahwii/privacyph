/**
 * Answer-cache key tests.  Run: npm test
 *
 * The cache exists because generation is the rented half of this system. The
 * key has to be strict in one direction and forgiving in the other: the same
 * question asked twice must hit, and a question answered under a different
 * system prompt must miss.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseQuestion, fingerprint, versionOf } from '../src/lib/cache-key.ts';

test('case, spacing and trailing punctuation do not change the question', () => {
  const canonical = 'do we always need consent to process personal data';
  for (const variant of [
    'Do we always need consent to process personal data?',
    '  do we   always need consent to process personal data  ',
    'DO WE ALWAYS NEED CONSENT TO PROCESS PERSONAL DATA!',
    'Do we always need consent to process personal data.',
  ]) {
    assert.equal(normaliseQuestion(variant), canonical, variant);
  }
});

test('different wording is a different question', () => {
  assert.notEqual(
    normaliseQuestion('Do we need consent?'),
    normaliseQuestion('Do we always need consent?')
  );
});

test('internal punctuation is preserved', () => {
  assert.equal(
    normaliseQuestion('We were breached. What now?'),
    'we were breached. what now'
  );
});

test('the same question under the same rules is the same key', () => {
  const a = fingerprint('Do we need consent?', 'abc123', 'dense');
  const b = fingerprint('  do we need CONSENT  ', 'abc123', 'dense');
  assert.equal(a, b);
});

test('a changed system prompt invalidates the answer', () => {
  // The point of versioning the key. An answer written when the prompt said
  // one thing about citations or refusals must not be served after it says
  // another -- it would contradict the rules actually in force.
  const before = fingerprint('Do we need consent?', versionOf('prompt v1'), 'dense');
  const after = fingerprint('Do we need consent?', versionOf('prompt v2'), 'dense');
  assert.notEqual(before, after);
});

test('switching retrieval mode invalidates the answer', () => {
  assert.notEqual(
    fingerprint('Do we need consent?', 'abc123', 'dense'),
    fingerprint('Do we need consent?', 'abc123', 'hybrid')
  );
});

test('versionOf is stable and short', () => {
  assert.equal(versionOf('x'), versionOf('x'));
  assert.equal(versionOf('x').length, 12);
  assert.notEqual(versionOf('x'), versionOf('y'));
});
