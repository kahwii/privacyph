/**
 * Check every citation in an eval result against the source PDFs.
 *
 *   node scripts/check-citations.mjs                     # newest result file
 *   node scripts/check-citations.mjs eval/results/X.csv
 *   node scripts/check-citations.mjs --self-test     # negative control
 *
 * No database, no API key, no cost — it reads ./corpus/ directly.
 *
 * What it checks: that a citation like [NPC-16-03, RULE V, SECTION 18] names a
 * section that actually exists in that document. A fabricated section number
 * is the failure that matters most in a compliance tool, because it is the one
 * a reader cannot catch without opening the issuance themselves.
 *
 * What it does NOT check: whether that section says what the answer claims it
 * says. That still needs a human, and it is what the answer_score_1to5 column
 * in the result CSV is for. A clean run here means no invented citations, not
 * a correct answer.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pdf from 'pdf-parse/lib/pdf-parse.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'docs/corpus.json'), 'utf8'));

function newestResult() {
  const dir = join(root, 'eval/results');
  const files = readdirSync(dir).filter((f) => f.endsWith('.csv')).sort();
  if (!files.length) throw new Error('no result files in eval/results');
  return join(dir, files[files.length - 1]);
}

/** Minimal RFC-4180 reader: the answer column contains commas and newlines. */
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

const corpus = new Map();
for (const doc of manifest) {
  const path = join(root, 'corpus', doc.file);
  if (!existsSync(path)) continue;
  const { text } = await pdf(readFileSync(path));
  corpus.set(doc.shortCode, text.replace(/\s+/g, ' ').toUpperCase());
}

const CITATION = /\[([A-Z0-9-]+),\s*([^\]]+)\]/g;
const truthy = (v) => ['true', '1', 'yes'].includes(String(v).trim().toLowerCase());

function locate(code, ref) {
  const body = corpus.get(code);
  if (!body) return 'NO SUCH DOCUMENT IN CORPUS';
  const numbers = ref.match(/\d+/g);
  if (!numbers) return body.includes(ref.trim().toUpperCase()) ? 'ok' : 'NOT FOUND';
  const n = numbers[numbers.length - 1];
  const found = [`SECTION ${n}.`, `SEC. ${n}.`, `SECTION ${n} `, `SEC. ${n} `]
    .some((p) => body.includes(p));
  return found ? 'ok' : 'NOT FOUND';
}

// A checker that cannot fail proves nothing, so it carries its own negative
// control: node scripts/check-citations.mjs --self-test
if (process.argv.includes('--self-test')) {
  const cases = [
    ['NPC-16-03', 'RULE V, SECTION 18', 'ok'],              // real section
    ['NPC-16-03', 'RULE V, SECTION 991', 'NOT FOUND'],      // invented section
    ['NPC-FAKE-9999', 'SECTION 1', 'NO SUCH DOCUMENT IN CORPUS'], // invented doc
  ];
  let failed = 0;
  for (const [code, ref, expected] of cases) {
    const actual = locate(code, ref);
    const pass = actual === expected;
    if (!pass) failed++;
    console.log(`  ${pass ? 'pass' : 'FAIL'}  [${code}, ${ref}] -> ${actual}` +
      (pass ? '' : `  (expected ${expected})`));
  }
  console.log(failed ? `\n  ${failed} self-test case(s) failed\n` : '\n  self-test ok\n');
  process.exit(failed ? 1 : 0);
}

const file = process.argv[2] ? join(root, process.argv[2]) : newestResult();
const rows = parseCsv(readFileSync(file, 'utf8'))
  .filter((r) => !truthy(r.generation_failed) && !truthy(r.declined_by_model));

console.log(`\n${file.replace(root + '/', '')} — ${rows.length} answers with citations to check\n`);

let total = 0;
const distinct = new Set();
const bad = [];

for (const r of rows) {
  for (const [, code, ref] of (r.answer || '').matchAll(CITATION)) {
    total++;
    const key = `${code}, ${ref.trim()}`;
    if (distinct.has(key)) continue;
    distinct.add(key);
    const verdict = locate(code, ref);
    if (verdict !== 'ok') bad.push({ id: r.id, key, verdict });
  }
}

for (const b of bad) console.log(`  #${b.id.padStart(2)}  ${b.key.padEnd(48)} ${b.verdict}`);

console.log(
  `  ${total} citations, ${distinct.size} distinct, across ` +
    `${new Set([...distinct].map((k) => k.split(',')[0])).size} documents`
);
console.log(
  bad.length
    ? `\n  ${bad.length} CITATION(S) DO NOT RESOLVE — open the issuance and check before shipping.\n`
    : '\n  All citations resolve to a section that exists.\n' +
      '  This does not mean the sections say what the answers claim. Score by hand.\n'
);
process.exit(bad.length ? 1 : 0);
