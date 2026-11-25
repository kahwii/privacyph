/**
 * Build a scoring sheet from an eval result, with the cited text beside the
 * claim that cites it.
 *
 *   node scripts/scoring-sheet.mjs                     # newest result file
 *   node scripts/scoring-sheet.mjs eval/results/X.csv
 *
 * Writes eval/results/<stamp>-scoring-sheet.txt. No database, no API key.
 *
 * Why this exists. answer_score_1to5 is scored by hand, and the slow part was
 * never the judgement -- it was opening a PDF to find out whether SECTION 17
 * says what the answer says it says. check-citations.mjs already proves the
 * section exists. This goes one step further and prints its opening under
 * every citation, so scoring becomes reading two things side by side.
 *
 * It deliberately does not score anything. Whether the reading is correct is
 * the one question the tooling cannot answer, and the whole value of the
 * manual column is that a person answered it.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { chunkLegalText } from '../src/lib/chunk.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'docs/corpus.json'), 'utf8'));

function newestResult() {
  const dir = join(root, 'eval/results');
  const files = readdirSync(dir).filter((f) => f.endsWith('.csv')).sort();
  if (!files.length) throw new Error('no result files in eval/results');
  return join(dir, files[files.length - 1]);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/**
 * "RULE V, SECTION 18 (A)", "RULE V, Section 18" and "Sec. 18" all name the
 * same section. The model cites the shape it saw in the context, which is not
 * always the shape the chunker stored.
 */
const key = (s) =>
  s
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bSECS?\b\.?/g, 'SECTION')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

const sections = new Map(); // shortCode -> Map(key -> {label, heading, content})
for (const doc of manifest) {
  const path = join(root, 'corpus', doc.file);
  if (!existsSync(path)) continue;
  const { text } = await pdf(readFileSync(path));
  const byKey = new Map();
  for (const c of chunkLegalText(text)) {
    const entry = {
      label: c.sectionLabel,
      heading: c.heading,
      content: c.content.replace(/\s+/g, ' ').trim(),
    };
    byKey.set(key(c.sectionLabel), entry);
    // Also reachable by heading alone: the model sometimes cites one, as it
    // did with NPC-16-03's "Summary" table.
    if (c.heading && !byKey.has(key(c.heading))) byKey.set(key(c.heading), entry);
  }
  sections.set(doc.shortCode, byKey);
}

function lookup(code, ref) {
  const byKey = sections.get(code);
  if (!byKey) return null;
  const k = key(ref);
  if (byKey.has(k)) return byKey.get(k);

  // "SECTION 16" against a stored "RULE V, SECTION 16": the citation drops the
  // rule. Match on the tail, and only when exactly one section ends that way,
  // so an ambiguous reference is reported rather than silently resolved to the
  // first candidate -- showing the wrong provision beside a claim is worse
  // than showing none.
  const tail = byKey.entries().toArray?.() ?? [...byKey.entries()];
  const suffix = tail.filter(([stored]) => stored.endsWith(' ' + k) || stored === k);
  if (suffix.length === 1) return suffix[0][1];

  // "RULE V, SECTION 18 A" -> drop trailing qualifiers one at a time.
  const parts = k.split(' ');
  for (let n = parts.length - 1; n > 1; n--) {
    const hit = byKey.get(parts.slice(0, n).join(' '));
    if (hit) return hit;
  }
  return null;
}

const wrap = (s, width, indent) =>
  s.replace(new RegExp(`(.{1,${width}})(\\s|$)`, 'g'), `${indent}$1\n`).trimEnd();

const CITATION = /\[([A-Z0-9-]+),\s*([^\]]+)\]/g;
const truthy = (v) => ['true', '1', 'yes'].includes(String(v).trim().toLowerCase());
const EXCERPT = 420;

const file = process.argv[2] ? join(root, process.argv[2]) : newestResult();
const rows = parseCsv(readFileSync(file, 'utf8'))
  .filter((r) => !truthy(r.generation_failed) && !truthy(r.declined_by_model));

const out = [];
out.push(`# Scoring sheet — ${basename(file)}`);
out.push('');
out.push(`${rows.length} answers to score. Under each citation is the opening of`);
out.push('the section it names, read from the PDF. Compare the two.');
out.push('');
out.push('  5 correct, grounded, right issuance cited, nothing invented');
out.push('  4 correct and grounded but incomplete, or cites a secondary issuance');
out.push('  3 half right, or so hedged it is useless');
out.push('  2 wrong in a way someone could act on');
out.push('  1 invented citation, invented deadline, or answered what it should have refused');
out.push('');
out.push('='.repeat(78));

let unresolved = 0;

for (const r of rows) {
  out.push('');
  out.push(`[${r.id}]  ${r.category}  (${r.lang})   confidence ${r.confidence}`);
  out.push('-'.repeat(78));
  out.push(wrap(`Q: ${r.question}`, 74, ''));
  const exp = r.expected_source + (r.expected_source_2?.trim() ? `  +  ${r.expected_source_2}` : '');
  out.push('');
  out.push(`expected : ${exp}`);
  out.push(`retrieved: ${r.retrieved_sources}`);
  out.push('');
  out.push('ANSWER:');
  out.push(wrap((r.answer || '').replace(/\s+/g, ' '), 72, '  '));

  const seen = new Set();
  const cites = [...(r.answer || '').matchAll(CITATION)];
  if (cites.length) {
    out.push('');
    out.push('  CITED TEXT ' + '-'.repeat(62));
  }
  for (const [, code, ref] of cites) {
    const k = `${code}|${key(ref)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const hit = lookup(code, ref);
    out.push('');
    out.push(`  [${code}, ${ref.trim()}]`);
    if (!hit) {
      unresolved++;
      out.push('    !! could not locate this section in the PDF — check by hand');
      continue;
    }
    const head = hit.heading ? `${hit.label} — ${hit.heading}` : hit.label;
    out.push(`    ${head}`);
    const text = hit.content.length > EXCERPT
      ? `${hit.content.slice(0, EXCERPT).trimEnd()}…`
      : hit.content;
    out.push(wrap(text, 68, '    '));
  }

  out.push('');
  out.push('SCORE: ___');
  out.push('');
}

const dest = join(root, 'eval/results', basename(file).replace(/\.csv$/, '-scoring-sheet.txt'));
writeFileSync(dest, out.join('\n'), 'utf8');
console.log(`\nwrote ${dest.replace(root + '/', '')}`);
console.log(`${rows.length} answers, ${unresolved} citation(s) the sheet could not resolve\n`);
