/**
 * Citation-grounding tests.  Run: npm test
 *
 * Every case below is a verbatim answer from eval/results — including the one
 * that caused the bug. The model declined correctly and omitted the
 * INSUFFICIENT_CONTEXT marker, so the app was about to render four Philippine
 * issuances underneath a refusal about German law.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citesSomething } from '../src/lib/prompt.ts';

test('an answer with citations is grounded', () => {
  assert.equal(
    citesSomething(
      'The personal information controller shall notify the Commission within ' +
        'seventy-two (72) hours [NPC-16-03, RULE V, SECTION 17].'
    ),
    true
  );
});

test('the degraded sources-only answer keeps its citations', () => {
  assert.equal(
    citesSomething('> [IRR-10173, RULE IX, Section 38]\n> When a personal data breach…'),
    true
  );
});

test('a prose refusal without the marker is not grounded', () => {
  // This is the one. Real answer, 2026-11-24 run, question 34.
  assert.equal(
    citesSomething(
      'I do not have the answer to your question. Please consult the National ' +
        'Privacy Commission at privacy.gov.ph.'
    ),
    false
  );
});

test('a context-does-not-say answer is not grounded', () => {
  // Real answer, question 25 — retrieval found the right issuance at rank 1
  // and the model still declined. No marker, so no suppression before this.
  assert.equal(
    citesSomething(
      'The provided context does not explicitly state whether a business is ' +
        'permitted to keep a photocopy of a customer ID.'
    ),
    false
  );
});

test('a supersession answer is not grounded either — the known cost', () => {
  // Real answer, question 27. Correct, and it cites nothing, because it is
  // answered from the repealed-issuances list rather than from a chunk. It
  // loses its sources panel. Documented rather than special-cased.
  assert.equal(
    citesSomething(
      'The 2020 NPC advisory on CCTV was replaced by NPC Circular No. 2024-02.'
    ),
    false
  );
});

test('prose that merely mentions a code is not a citation', () => {
  assert.equal(citesSomething('NPC Circular 16-03 governs breach management.'), false);
});
