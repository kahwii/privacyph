/**
 * Retrieval + citation eval.
 *
 *   npm run eval
 *
 * Scores three things per question:
 *   retrieval_hit   — was the expected source in the retrieved set?
 *   top1_hit        — was it the single best match?
 *   refusal_correct — did a refusal-control question get refused?
 *
 * Answer correctness stays manual: open eval/results/<timestamp>.csv and
 * score the answer column 1-5 yourself. Automating that with an LLM judge is
 * a later improvement, not a substitute.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { retrieve, rerank } from '../src/lib/retrieval';
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  REFUSAL,
  stripInsufficientMarker,
} from '../src/lib/prompt';
import { supersessions } from '../src/lib/retrieval';
import { generate } from '../src/lib/llm';

const CONFIDENCE_FLOOR = 0.45;

interface Row {
  id: string;
  category: string;
  question: string;
  expected_answer: string;
  expected_source: string;
  expected_section: string;
}

function parseCsv(text: string): Row[] {
  const lines = text.trim().split('\n');
  const headers = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ''])) as unknown as Row;
  });
}

/** Minimal CSV splitter that respects double-quoted fields. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function csvCell(v: string | number | boolean): string {
  return `"${String(v).replace(/"/g, '""')}"`;
}

async function main() {
  const rows = parseCsv(readFileSync(join(process.cwd(), 'eval/questions.csv'), 'utf8'));

  let retrievalHits = 0;
  let top1Hits = 0;
  let refusalCorrect = 0;
  let genFailures = 0;
  let floorMissed = 0;
  let refusalUnscored = 0;
  let scorable = 0;
  let refusalCases = 0;

  const scores: { confidence: number; control: boolean }[] = [];

  const results: string[] = [
    ['id', 'category', 'question', 'expected_source', 'retrieved_sources',
     'retrieval_hit', 'top1_hit', 'confidence', 'refused_by_floor',
     'declined_by_model', 'generation_failed', 'answer',
     'answer_score_1to5'].join(',')
  ];

  for (const row of rows) {
    const chunks = rerank(row.question, await retrieve(row.question));
    const top = chunks[0];
    const confidence = top?.similarity ?? 0;
    const refused = chunks.length === 0 || confidence < CONFIDENCE_FLOOR;

    // Retrieval is the metric this harness exists to measure. A 503 from a
    // saturated free-tier model says nothing about retrieval quality, so it is
    // recorded and stepped over rather than allowed to end the run.
    let answer: string;
    let generationFailed = false;
    let modelDeclined = false;

    if (refused) {
      answer = REFUSAL;
    } else {
      try {
        const raw = await generate(
          SYSTEM_PROMPT,
          buildUserPrompt(row.question, chunks, await supersessions())
        );
        const parsed = stripInsufficientMarker(raw);
        answer = parsed.text;
        modelDeclined = parsed.insufficient;
      } catch (err) {
        answer = 'GENERATION_FAILED: ' + (err as Error).message.replace(/\s+/g, ' ').slice(0, 120);
        generationFailed = true;
        genFailures++;
      }
    }

    const retrievedSources = [...new Set(chunks.map((c) => c.short_code))];
    const isRefusalCase = row.expected_source === 'NONE';
    scores.push({ confidence, control: isRefusalCase });

    let retrievalHit = false;
    let top1Hit = false;

    if (isRefusalCase) {
      // Two independent defences: the retrieval floor, and the model judging
      // the retrieved context insufficient. Either one counts as a refusal,
      // because either one stops a fabricated answer reaching the user.
      //
      // A control whose generation never ran is UNSCORED, not failed. Scoring
      // it as "answered" reports a hallucination that never happened — which
      // is exactly what this harness did on its first run.
      if (generationFailed && !refused) {
        refusalUnscored++;
      } else {
        refusalCases++;
        if (refused || modelDeclined) refusalCorrect++;
        if (!refused && modelDeclined) floorMissed++;
      }
    } else {
      scorable++;
      retrievalHit = retrievedSources.includes(row.expected_source);
      top1Hit = top?.short_code === row.expected_source;
      if (retrievalHit) retrievalHits++;
      if (top1Hit) top1Hits++;
    }

    results.push([
      row.id, row.category, csvCell(row.question), row.expected_source,
      csvCell(retrievedSources.join(' ')), retrievalHit, top1Hit,
      confidence.toFixed(3), refused, modelDeclined, generationFailed, csvCell(answer), ''
    ].join(','));

    process.stdout.write(
      `${row.id.padStart(3)} ${isRefusalCase
        ? (refused
          ? 'refused floor'
          : modelDeclined
            ? 'declined model'
            : generationFailed
              ? 'unscored      '
              : 'ANSWERED IT   ')
        : (retrievalHit ? (top1Hit ? 'hit  top1    ' : 'hit  in-set  ') : 'MISS         ')
      } ${confidence.toFixed(3)}  ${row.question.slice(0, 54)}\n`
    );
  }

  const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) : '—');

  console.log('\n--- summary -------------------------------');
  console.log(
    `questions          ${rows.length} (${scorable} scorable, ` +
    `${refusalCases} refusal controls scored, ${refusalUnscored} unscored)`
  );
  console.log(`retrieval accuracy ${pct(retrievalHits, scorable)}%  (${retrievalHits}/${scorable})`);
  console.log(`top-1 accuracy     ${pct(top1Hits, scorable)}%  (${top1Hits}/${scorable})`);
  console.log(`refusal accuracy   ${pct(refusalCorrect, refusalCases)}%  (${refusalCorrect}/${refusalCases})`);
  if (refusalUnscored) {
    console.log(
      `  ${refusalUnscored} control(s) unscored — generation never ran, so there was no answer to judge`
    );
  }
  if (floorMissed) {
    console.log(
      `  of which ${floorMissed} passed the retrieval floor and were caught by the model`
    );
  }

  // The separation between on-topic and off-topic similarity is the number
  // that decides whether a threshold can work at all.
  const onTopic = scores.filter((s) => !s.control).map((s) => s.confidence);
  const offTopic = scores.filter((s) => s.control).map((s) => s.confidence);
  const lo = (a: number[]) => Math.min(...a).toFixed(3);
  const hi = (a: number[]) => Math.max(...a).toFixed(3);
  if (onTopic.length && offTopic.length) {
    console.log('\nsimilarity distribution');
    console.log(`  on-topic   ${lo(onTopic)} – ${hi(onTopic)}`);
    console.log(`  off-topic  ${lo(offTopic)} – ${hi(offTopic)}`);
    console.log(
      Number(lo(onTopic)) > Number(hi(offTopic))
        ? `  separated — a floor between ${hi(offTopic)} and ${lo(onTopic)} would work`
        : '  OVERLAPPING — no single threshold separates them, so the model-level\n' +
          '  refusal is doing the real work, not MIN_SIMILARITY'
    );
  }
  if (genFailures) {
    console.log(
      `\nNOTE: generation failed on ${genFailures} question(s) — free-tier capacity, ` +
      `not retrieval. The retrieval numbers above are unaffected; re-run later ` +
      `to score the answers.`
    );
  }

  mkdirSync(join(process.cwd(), 'eval/results'), { recursive: true });
  const out = join(process.cwd(), `eval/results/${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
  writeFileSync(out, results.join('\n'));
  console.log(`\nwrote ${out}`);
  console.log('Now score the answer column 1-5 by hand and commit the file.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
