/**
 * Reranking tests.  Run: npm test
 *
 * The case that prompted these: asked what to do about a breach affecting 300
 * customers, retrieval put NPC-16-03's effectivity clause and signature block
 * in third place. Right issuance, section that answers nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rerank } from '../src/lib/rank.ts';
import type { RetrievedChunk } from '../src/lib/retrieval.ts';

function chunk(
  heading: string | null,
  similarity: number,
  section_label = 'RULE V, SECTION 1'
): RetrievedChunk {
  return {
    chunk_id: heading ?? 'none',
    content: '',
    section_label,
    heading,
    short_code: 'NPC-16-03',
    doc_title: 'Personal Data Breach Management',
    source_url: '',
    similarity,
  };
}

const order = (cs: RetrievedChunk[]) => cs.map((c) => c.heading);

test('an effectivity clause loses to a substantive section it outscored', () => {
  const ranked = rerank('We were breached yesterday. What do we have to do?', [
    chunk('Effectivity', 0.70),
    chunk('Notification of the Commission', 0.66),
  ]);
  assert.deepEqual(order(ranked), ['Notification of the Commission', 'Effectivity']);
});

test('a separability clause is demoted the same way', () => {
  const ranked = rerank('What has to be in the notification we send?', [
    chunk('Separability Clause', 0.69),
    chunk('Contents of Notification', 0.65),
  ]);
  assert.deepEqual(order(ranked), ['Contents of Notification', 'Separability Clause']);
});

test('repealing and transitory clauses are NOT demoted', () => {
  // A repealing clause bears on what is still in force; transitory provisions
  // carry compliance deadlines. Demoting them trades one blind spot for another.
  for (const h of ['Repealing Clause', 'Transitory Provision']) {
    const ranked = rerank('Do we have to register with the NPC?', [
      chunk(h, 0.70),
      chunk('Registration', 0.66),
    ]);
    assert.equal(ranked[0].heading, h, `${h} should keep its place`);
  }
});

test('when the question is about commencement the clause is the answer', () => {
  const ranked = rerank('When did this circular take effect?', [
    chunk('Effectivity', 0.70),
    chunk('Notification of the Commission', 0.66),
  ]);
  assert.deepEqual(order(ranked), ['Effectivity', 'Notification of the Commission']);
});

test('the existing section-reference boost still wins', () => {
  const ranked = rerank('what does Section 18 say', [
    chunk('Effectivity', 0.70, 'RULE V, SECTION 25'),
    chunk('Notification of Data Subjects', 0.60, 'RULE V, SECTION 18'),
  ]);
  assert.equal(ranked[0].heading, 'Notification of Data Subjects');
});

test('a chunk with no heading is untouched', () => {
  const ranked = rerank('anything', [chunk(null, 0.70), chunk('Scope', 0.60)]);
  assert.deepEqual(order(ranked), [null, 'Scope']);
});
