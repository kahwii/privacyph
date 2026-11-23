/**
 * Breach assessment tests.  Run: npm test
 * Uses node's built-in test runner and native TypeScript stripping — no jest,
 * no config, no extra dependency.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, draftNotification, type BreachIntake } from '../src/lib/breach.ts';

const base: BreachIntake = {
  categories: ['sensitive_personal'],
  unauthorizedAcquisition: true,
  riskOfSeriousHarm: true,
  affectedCount: 300,
  knownAt: new Date('2026-11-23T09:00:00+08:00'),
};

test('all three prongs met → notifiable', () => {
  const r = assess(base);
  assert.equal(r.notifiable, true);
  assert.equal(r.test.filter((t) => t.satisfied).length, 3);
});

test('deadline is 72 hours after knowledge', () => {
  const r = assess(base);
  assert.ok(r.deadline);
  assert.equal(
    r.deadline.getTime() - base.knownAt.getTime(),
    72 * 3600 * 1000
  );
});

test('100+ data subjects removes any postponement', () => {
  const r = assess({ ...base, affectedCount: 100 });
  assert.equal(r.noDelayPermitted, true);
  assert.ok(r.noDelayReasons.some((x) => x.includes('100')));
});

test('99 data subjects with SPI harm still removes postponement on the other ground', () => {
  const r = assess({ ...base, affectedCount: 99 });
  assert.equal(r.noDelayPermitted, true);
  assert.ok(r.noDelayReasons.some((x) => x.includes('sensitive personal information')));
});

test('99 affected, non-sensitive qualifying data → delay may be permitted', () => {
  const r = assess({ ...base, categories: ['credentials'], affectedCount: 99 });
  assert.equal(r.notifiable, true);
  assert.equal(r.noDelayPermitted, false);
  assert.ok(r.notes.some((n) => n.includes('postponement or exemption must be requested')));
});

test('credentials alone qualify as data that may enable identity fraud', () => {
  const r = assess({ ...base, categories: ['credentials'] });
  assert.equal(r.test[0].satisfied, true);
});

test('names and contact details alone do not satisfy the first prong', () => {
  const r = assess({ ...base, categories: ['basic_contact'] });
  assert.equal(r.test[0].satisfied, false);
  assert.equal(r.notifiable, false);
  assert.equal(r.deadline, null);
});

test('no real risk of serious harm → not notifiable, but logged', () => {
  const r = assess({ ...base, riskOfSeriousHarm: false });
  assert.equal(r.notifiable, false);
  assert.ok(r.notes.some((n) => n.includes('Annual Security Incident Report')));
});

test('no unauthorized acquisition → not notifiable', () => {
  const r = assess({ ...base, unauthorizedAcquisition: false });
  assert.equal(r.notifiable, false);
});

test('NPC and data subjects are both named, as separate obligations', () => {
  const r = assess(base);
  assert.deepEqual(r.notifyParties, [
    'National Privacy Commission',
    'Affected data subjects',
  ]);
  assert.ok(r.notes.some((n) => n.includes('separate obligations')));
});

test('draft contains all four required parts and no unfilled category', () => {
  const r = assess(base);
  const draft = draftNotification(base, r, {
    name: 'Acme Trading Inc.',
    dpoName: 'Juan dela Cruz',
    dpoEmail: 'dpo@acme.ph',
    dpoPhone: '+63 2 8123 4567',
  });
  for (const part of [
    'I. NATURE OF THE BREACH',
    'II. PERSONAL DATA POSSIBLY INVOLVED',
    'III. MEASURES TAKEN TO ADDRESS THE BREACH',
    'IV. CONTACT DETAILS',
  ]) {
    assert.ok(draft.includes(part), `missing ${part}`);
  }
  assert.ok(draft.includes('sensitive personal information'));
  assert.ok(draft.includes('Juan dela Cruz'));
  assert.ok(draft.includes('300'));
  assert.ok(draft.includes('Not legal advice'));
});
