/**
 * Downloads every corpus document that has a direct PDF URL in
 * docs/corpus.json into ./corpus/, named as the manifest expects.
 *
 *   node scripts/fetch-corpus.mjs            download what it can
 *   node scripts/fetch-corpus.mjs --dry-run  show the plan, download nothing
 *
 * Plain Node, no dependencies, works the same on Windows, macOS and Linux.
 *
 * Two things this handles that a bare curl does not:
 *
 *   - privacy.gov.ph sits behind Cloudflare and returns 403 on some files
 *     depending on the user agent. Each entry may carry `fallbackUrls` with
 *     equally authoritative copies (the Senate and Official Gazette host the
 *     statutes too); every URL is tried in order before giving up.
 *   - A blocked request or a login wall often returns HTML with status 200.
 *     The magic bytes are checked, so you never end up with an HTML file
 *     named .pdf that fails confusingly at ingest time.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpusDir = join(root, 'corpus');
const dryRun = process.argv.includes('--dry-run');

const manifest = JSON.parse(readFileSync(join(root, 'docs/corpus.json'), 'utf8'));
mkdirSync(corpusDir, { recursive: true });

// Identify the script honestly. Measured: this got 4 of 5 files from
// privacy.gov.ph, while a borrowed Chrome UA got 0 of 25 — Cloudflare treats a
// request that claims to be a browser but is not as more suspicious than one
// that is plainly a script. Do not "fix" this by impersonating a browser.
const UA =
  'PrivacyPH-corpus-fetch/1.0 (student project; contact: your-email@example.com)';

const isPdfUrl = (u) => /\.pdf(\?|$)/i.test(u);

/** Every candidate URL for a document, in preference order. */
const urlsFor = (doc) =>
  [doc.sourceUrl, ...(doc.fallbackUrls ?? [])].filter(isPdfUrl);

const auto = manifest.filter((d) => urlsFor(d).length > 0);
const manual = manifest.filter((d) => urlsFor(d).length === 0);

console.log(`${auto.length} fetchable, ${manual.length} to save by hand\n`);

let ok = 0;
let skipped = 0;
const failures = [];

for (const doc of auto) {
  const target = join(corpusDir, doc.file);

  if (existsSync(target) && statSync(target).size > 1024) {
    console.log(`  = ${doc.file.padEnd(28)} already present`);
    skipped++;
    continue;
  }

  const candidates = urlsFor(doc);

  if (dryRun) {
    console.log(`  . ${doc.file.padEnd(28)} ${candidates.length} candidate URL(s)`);
    continue;
  }

  let saved = false;
  const attempts = [];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*' },
        signal: AbortSignal.timeout(90_000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const buf = Buffer.from(await res.arrayBuffer());

      if (buf.subarray(0, 4).toString('latin1') !== '%PDF') {
        throw new Error('not a PDF (blocked, or an HTML page)');
      }

      writeFileSync(target, buf);
      const via = url === doc.sourceUrl ? '' : ' (via fallback)';
      console.log(`  + ${doc.file.padEnd(28)} ${(buf.length / 1024).toFixed(0)} KB${via}`);
      ok++;
      saved = true;
      break;
    } catch (err) {
      attempts.push(`      ${url}\n        ${err.message}`);
    }
  }

  if (!saved) {
    console.log(`  ! ${doc.file.padEnd(28)} all ${candidates.length} source(s) failed`);
    failures.push({ doc, attempts });
  }
}

console.log(`\ndownloaded ${ok}, already had ${skipped}, failed ${failures.length}`);

if (failures.length) {
  console.log('\nFailed — open the link in your browser and save it by hand:\n');
  for (const { doc, attempts } of failures) {
    console.log(`  ${doc.file}  (${doc.shortCode})`);
    console.log(attempts.join('\n'));
    console.log('');
  }
}

if (manual.length) {
  console.log('No direct PDF — open the page, find the PDF link, save as:\n');
  for (const d of manual) {
    console.log(`  ${d.file}`);
    console.log(`      ${d.shortCode} — ${d.title}`);
    console.log(`      ${d.sourceUrl}\n`);
  }
}

const have = manifest.filter((d) => {
  const t = join(corpusDir, d.file);
  return existsSync(t) && statSync(t).size > 1024;
}).length;

console.log(`corpus: ${have}/${manifest.length} documents in ./corpus/`);
console.log(have > 0 ? 'Next: npm run ingest' : 'Nothing to ingest yet.');
