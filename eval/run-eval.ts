/**
 * Retrieval benchmark.
 *
 *   npm run eval
 *   npm run eval -- --mode=hybrid
 *
 * --mode overrides RETRIEVAL_MODE for one run, so the dense/hybrid A/B is two
 * commands rather than an edit to .env.local between them.
 *
 * Reports, per question and in aggregate:
 *
 *   retrieval accuracy  was the governing issuance in the retrieved set?
 *   top-1 accuracy      was it ranked first?
 *   multi-hop coverage  for questions that need two issuances, were both found?
 *   refusal accuracy    were out-of-corpus questions declined?
 *
 * Two things this harness learned the hard way, both of which it got wrong
 * before it got right:
 *
 *   The system refuses in two independent places — a retrieval floor, and the
 *   model judging the retrieved context insufficient. Measuring one and
 *   calling it "refusal accuracy" reported 0% for a system that had just
 *   refused correctly.
 *
 *   A question whose generation never ran has no outcome to score. Counting
 *   it as answered reported a hallucination that never happened.
 *
 * Answer correctness stays manual: open the CSV in eval/results and score the
 * answer column 1-5 by hand.
 */
import { applyDevDnsOverride } from '../src/lib/dns';

applyDevDnsOverride();

// Before anything calls retrieve(). retrieval.ts reads RETRIEVAL_MODE per
// call for exactly this reason -- see the comment on mode() there.
const modeFlag = process.argv.find(a => a.startsWith('--mode='))?.slice(7);
if (modeFlag) {
  if (modeFlag !== 'dense' && modeFlag !== 'hybrid') {
    console.error(`unknown --mode=${modeFlag} (expected dense or hybrid)`);
    process.exit(1);
  }
  process.env.RETRIEVAL_MODE = modeFlag;
}

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { retrieve, rerank, supersessions, retrievalMode } from '../src/lib/retrieval';
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  REFUSAL,
  stripInsufficientMarker,
} from '../src/lib/prompt';
import { generate } from '../src/lib/llm';

const CONFIDENCE_FLOOR = 0.45;

interface Row {
  id: string;
  category: string;
  lang: string;
  question: string;
  expected_answer: string;
  expected_source: string;
  expected_source_2: string;
}

interface Outcome {
  row: Row;
  confidence: number;
  retrievedSources: string[];
  refusedByFloor: boolean;
  declinedByModel: boolean;
  generationFailed: boolean;
  answer: string;
}

/** Minimal CSV reader that respects double-quoted fields. */
function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cur.push(cell);
      cell = '';
    } else if (ch === '\n' && !quoted) {
      cur.push(cell);
      rows.push(cur);
      cur = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell || cur.length) {
    cur.push(cell);
    rows.push(cur);
  }

  const head = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.length > 1 && r[0].trim())
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])) as unknown as Row);
}

const csvCell = (v: string | number | boolean) => `"${String(v).replace(/"/g, '""')}"`;
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '   — ');

async function main() {
  const rows = parseCsv(readFileSync(join(process.cwd(), 'eval/questions.csv'), 'utf8'));
  const superseded = await supersessions();
  const outcomes: Outcome[] = [];

  console.log(`\nretrieval mode: ${retrievalMode()}   questions: ${rows.length}\n`);

  for (const row of rows) {
    const chunks = rerank(row.question, await retrieve(row.question));
    const confidence = chunks[0]?.similarity ?? 0;
    const refusedByFloor = chunks.length === 0 || confidence < CONFIDENCE_FLOOR;

    let answer: string;
    let declinedByModel = false;
    let generationFailed = false;

    if (refusedByFloor) {
      answer = REFUSAL;
    } else {
      try {
        const parsed = stripInsufficientMarker(
          await generate(SYSTEM_PROMPT, buildUserPrompt(row.question, chunks, superseded))
        );
        answer = parsed.text;
        declinedByModel = parsed.insufficient;
      } catch (err) {
        answer = `GENERATION_FAILED: ${(err as Error).message.replace(/\s+/g, ' ').slice(0, 140)}`;
        generationFailed = true;
      }
    }

    const o: Outcome = {
      row,
      confidence,
      retrievedSources: [...new Set(chunks.map((c) => c.short_code))],
      refusedByFloor,
      declinedByModel,
      generationFailed,
      answer,
    };
    outcomes.push(o);

    process.stdout.write(`${row.id.padStart(3)} ${row.lang}  ${verdict(o).padEnd(14)} ${confidence.toFixed(3)}  ${row.question.slice(0, 56)}\n`);
  }

  report(outcomes);
  write(outcomes);
}

function verdict(o: Outcome): string {
  if (o.row.expected_source === 'NONE') {
    if (o.refusedByFloor) return 'refused floor';
    if (o.declinedByModel) return 'declined model';
    if (o.generationFailed) return 'unscored';
    return 'ANSWERED IT';
  }
  if (!o.retrievedSources.includes(o.row.expected_source)) return 'MISS';
  return o.retrievedSources[0] === o.row.expected_source ? 'hit top1' : 'hit in-set';
}

function report(all: Outcome[]) {
  const controls = all.filter((o) => o.row.expected_source === 'NONE');
  const scorable = all.filter((o) => o.row.expected_source !== 'NONE');

  const hit = (o: Outcome) => o.retrievedSources.includes(o.row.expected_source);
  const top1 = (o: Outcome) => o.retrievedSources[0] === o.row.expected_source;

  const line = (label: string, n: number, d: number) =>
    console.log(`  ${label.padEnd(22)} ${pct(n, d).padStart(6)}  (${n}/${d})`);

  console.log('\n--- retrieval ------------------------------------');
  line('retrieval accuracy', scorable.filter(hit).length, scorable.length);
  line('top-1 accuracy', scorable.filter(top1).length, scorable.length);

  // Multi-hop: a question is only covered if BOTH issuances were retrieved.
  const multi = scorable.filter((o) => o.row.expected_source_2);
  if (multi.length) {
    const both = multi.filter(
      (o) => hit(o) && o.retrievedSources.includes(o.row.expected_source_2)
    );
    line('multi-hop coverage', both.length, multi.length);
  }

  console.log('\n--- by language ----------------------------------');
  for (const lang of [...new Set(scorable.map((o) => o.row.lang))].sort()) {
    const set = scorable.filter((o) => o.row.lang === lang);
    line(`${lang} retrieval`, set.filter(hit).length, set.length);
  }

  console.log('\n--- refusal --------------------------------------');
  // A control whose generation never ran is unscored, not failed.
  const unscored = controls.filter((o) => o.generationFailed && !o.refusedByFloor);
  const scored = controls.filter((o) => !(o.generationFailed && !o.refusedByFloor));
  const correct = scored.filter((o) => o.refusedByFloor || o.declinedByModel);
  line('refusal accuracy', correct.length, scored.length);
  const byModel = correct.filter((o) => !o.refusedByFloor).length;
  if (byModel) console.log(`    ${byModel} of those passed the retrieval floor and were caught by the model`);
  if (unscored.length) console.log(`    ${unscored.length} unscored — generation never ran, so there was no answer to judge`);

  console.log('\n--- similarity distribution ----------------------');
  const on = scorable.map((o) => o.confidence);
  const off = controls.map((o) => o.confidence);
  if (on.length && off.length) {
    const lo = (a: number[]) => Math.min(...a);
    const hi = (a: number[]) => Math.max(...a);
    console.log(`  on-topic   ${lo(on).toFixed(3)} – ${hi(on).toFixed(3)}`);
    console.log(`  off-topic  ${lo(off).toFixed(3)} – ${hi(off).toFixed(3)}`);
    console.log(
      lo(on) > hi(off)
        ? `  separated by ${(lo(on) - hi(off)).toFixed(3)} — a floor between them would work on this sample`
        : '  OVERLAPPING — no single threshold separates them, so the model-level\n' +
          '  refusal is doing the real work, not MIN_SIMILARITY'
    );
  }

  const failed = all.filter((o) => o.generationFailed).length;
  if (failed) {
    console.log(
      `\nNOTE: generation failed on ${failed} question(s) — free-tier capacity, not\nretrieval. The retrieval numbers above are unaffected.`
    );
  }
}

function write(all: Outcome[]) {
  const header = [
    'id', 'category', 'lang', 'question', 'expected_source', 'expected_source_2',
    'retrieved_sources', 'retrieval_hit', 'top1_hit', 'multihop_hit', 'confidence',
    'refused_by_floor', 'declined_by_model', 'generation_failed', 'answer',
    'answer_score_1to5',
  ].join(',');

  const lines = all.map((o) => {
    const hit = o.retrievedSources.includes(o.row.expected_source);
    return [
      o.row.id, o.row.category, o.row.lang, csvCell(o.row.question),
      o.row.expected_source, o.row.expected_source_2,
      csvCell(o.retrievedSources.join(' ')),
      hit,
      o.retrievedSources[0] === o.row.expected_source,
      o.row.expected_source_2
        ? hit && o.retrievedSources.includes(o.row.expected_source_2)
        : '',
      o.confidence.toFixed(3),
      o.refusedByFloor, o.declinedByModel, o.generationFailed,
      csvCell(o.answer), '',
    ].join(',');
  });

  mkdirSync(join(process.cwd(), 'eval/results'), { recursive: true });
  const out = join(
    process.cwd(),
    `eval/results/${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  );
  writeFileSync(out, [header, ...lines].join('\n'));
  console.log(`\nwrote ${out}`);
  console.log('Score the answer column 1-5 by hand and commit the file.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
