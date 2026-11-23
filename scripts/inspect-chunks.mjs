/**
 * Dry-run the chunker over whatever is in ./corpus/ and report what it found.
 * No embeddings, no database, no API key, no cost — this only answers the
 * question "did the chunker actually understand these documents?"
 *
 *   node scripts/inspect-chunks.mjs
 *   node scripts/inspect-chunks.mjs --show npc-16-03.pdf
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { chunkLegalText } from '../src/lib/chunk.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'docs/corpus.json'), 'utf8'));
const showIdx = process.argv.indexOf('--show');
const showFile = showIdx > -1 ? process.argv[showIdx + 1] : null;

let totalChunks = 0;

for (const doc of manifest) {
  const path = join(root, 'corpus', doc.file);
  if (!existsSync(path)) continue;

  const { text, numpages } = await pdf(readFileSync(path));
  const chunks = chunkLegalText(text);
  totalChunks += chunks.length;

  const preamble = chunks.filter((c) => c.sectionLabel.startsWith('Preamble')).length;
  const withRule = chunks.filter((c) => c.sectionLabel.includes('RULE')).length;
  const avg = chunks.length
    ? Math.round(chunks.reduce((s, c) => s + c.content.length, 0) / chunks.length)
    : 0;
  const longest = Math.max(0, ...chunks.map((c) => c.content.length));

  const flag =
    chunks.length === 0 ? '  <-- NOTHING EXTRACTED'
    : chunks.length < 5 ? '  <-- suspiciously few; check the PDF'
    : preamble / chunks.length > 0.5 ? '  <-- mostly unsectioned; chunker did not find structure'
    : '';

  console.log(
    `${doc.shortCode.padEnd(16)} ${String(numpages).padStart(3)}p  ` +
    `${String(chunks.length).padStart(4)} sections  ` +
    `avg ${String(avg).padStart(5)} chars  max ${String(longest).padStart(5)}  ` +
    `${String(withRule).padStart(3)} under a RULE${flag}`
  );

  if (showFile && doc.file === showFile) {
    console.log('\n--- sections ---');
    for (const c of chunks) {
      console.log(`  ${c.sectionLabel.padEnd(26)} ${(c.heading ?? '').slice(0, 60)}`);
    }
    console.log('');
  }
}

console.log(`\n${totalChunks} sections total — this is roughly how many embeddings you will pay for.`);
