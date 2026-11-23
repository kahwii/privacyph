/**
 * Chunker regression tests.
 *
 * Each case here is a real failure found while ingesting the corpus, not a
 * hypothetical. They exist so a later "cleanup" of the chunker cannot quietly
 * undo them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkLegalText } from '../src/lib/chunk.ts';

test('numbered sections split one per section, with the RULE as a prefix', () => {
  const out = chunkLegalText(`
RULE V. NOTIFICATION OF PERSONAL DATA BREACH

Sec. 17. When notification is required. Notification of the Commission and affected data subjects shall be required upon knowledge of or when there is reasonable belief that a personal data breach has occurred under these Rules, which is a long enough passage to survive the minimum length filter applied to every chunk.

Sec. 18. When notification should be done. The Commission and affected data subjects shall be notified within seventy-two (72) hours upon knowledge of or the reasonable belief that a personal data breach has occurred, and there shall be no delay where the breach involves at least one hundred data subjects.
`);

  const s18 = out.find((c) => c.sectionLabel === 'RULE V, Sec. 18');
  assert.ok(s18, 'Sec. 18 should be its own chunk under RULE V');
  assert.equal(s18.heading, 'When notification should be done');
  assert.ok(s18.content.includes('seventy-two'));
  // The provision must not be split across chunks.
  assert.ok(s18.content.includes('one hundred data subjects'));
});

test('the heading is a short title, not the whole body', () => {
  const [chunk] = chunkLegalText(
    'SECTION 1. Scope. These Rules shall apply to all natural and juridical persons in the government or private sector processing personal data inside and outside of the Philippines, subject to the relevant provisions of the Act and these Rules as they may be amended from time to time.'
  );
  assert.equal(chunk.heading, 'Scope');
});

test('runs of whitespace from PDF extraction are collapsed', () => {
  const [chunk] = chunkLegalText(
    'SECTION 36. Right  to  Data   Portability. The  data  subject  shall  have  the  right  to  obtain  a  copy  of  personal  data  in  an  electronic  or  structured  format  that  is  commonly  used  and  allows  for  further  use.'
  );
  assert.equal(chunk.heading, 'Right to Data Portability');
  assert.ok(!/ {2}/.test(chunk.content), 'no double spaces should remain');
});

test('repeated running heads and page numbers are stripped', () => {
  const head = 'NPC Advisory No. 2017-01';
  const body = (n: number) =>
    `SECTION ${n}. Heading ${n}. Body text for section ${n} that is long enough to clear the minimum length filter applied to every chunk in the pipeline, with some padding.`;

  const out = chunkLegalText(
    [body(1), head, '3', body(2), head, '4', body(3), head, '5', body(4), body(5)].join('\n\n')
  );

  assert.equal(out.length, 5);
  for (const c of out) {
    assert.ok(!c.content.includes(head), 'running head leaked into a chunk');
    assert.ok(!/^\d{1,3}$/m.test(c.content), 'bare page number leaked into a chunk');
  }
});

test('documents with bare title headings fall back to heading detection', () => {
  // The 2017-era advisories carry no section numbers at all, and each heading
  // is followed by a blank line — which is what broke the first attempt.
  const text = `
NPC Advisory No. 2017-01

SUBJECT : DESIGNATION OF DATA PROTECTION OFFICERS

Preamble

WHEREAS, Section 21(b) of the DPA provides that personal information controllers shall designate an individual accountable for the organization's compliance with the Act, and this clause runs long enough to be kept.

Scope

These Guidelines shall apply to all natural or juridical persons, or any other body involved in the processing of personal data within and outside of the Philippines, subject to the applicable provisions.

Definition of Terms

For purposes of these Guidelines, the terms used herein shall carry the meanings assigned to them under the Act, its Implementing Rules and Regulations, and the issuances of the Commission.

Mandatory Designation

A personal information controller or personal information processor shall designate an individual or individuals who shall function as data protection officer, and that designation must be documented properly.
`;

  const out = chunkLegalText(text);
  const labels = out.map((c) => c.sectionLabel);

  for (const expected of ['Scope', 'Definition of Terms', 'Mandatory Designation']) {
    assert.ok(labels.includes(expected), `missing heading: ${expected}`);
  }
  // Metadata lines must not become sections.
  assert.ok(
    !labels.some((l) => l.includes('SUBJECT') || l.includes('DATE')),
    'a metadata line was treated as a heading'
  );
});

test('wrapped headings do not become separate sections', () => {
  const text = `
Preamble

WHEREAS, this preamble is long enough to be retained by the minimum length filter that drops stubs and page furniture from the output.

Independence, Autonomy
And Conflict of Interest

The data protection officer shall enjoy independence in the performance of functions, and shall be accorded the autonomy necessary to raise concerns without fear of reprisal from management.

Accountability

The personal information controller remains accountable for compliance with the Act regardless of the designation, and shall be able to demonstrate that accountability on request.
`;

  const labels = chunkLegalText(text).map((c) => c.sectionLabel);
  assert.ok(labels.includes('Independence, Autonomy'));
  assert.ok(
    !labels.some((l) => /^And Conflict/.test(l)),
    'the continuation line became its own section'
  );
});

test('an over-long section is split, keeping its label', () => {
  const filler = 'This sentence pads the section out so that it exceeds the maximum chunk size. '.repeat(70);
  const out = chunkLegalText(`SECTION 9. Very Long Section. ${filler}`);
  assert.ok(out.length > 1, 'a section past the cap should be split');
  for (const c of out) {
    assert.match(c.sectionLabel, /^SECTION 9 \(\d\)$/);
    assert.ok(c.content.length <= 4200);
  }
});

test('ordinals are contiguous from zero', () => {
  const out = chunkLegalText(
    [1, 2, 3]
      .map((n) => `SECTION ${n}. Heading ${n}. Body text for section ${n}, padded out generously so that it comfortably clears the minimum length filter that the chunker applies to every candidate chunk before returning it.`)
      .join('\n\n')
  );
  assert.deepEqual(out.map((c) => c.ordinal), [0, 1, 2]);
});
