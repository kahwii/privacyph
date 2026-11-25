/**
 * Fill the answer cache before anyone else arrives.
 *
 *   node scripts/warm-cache.mjs                        # against production
 *   node scripts/warm-cache.mjs http://localhost:3000
 *
 * Generation is the rented half of this system. When Google sheds free-tier
 * load every model returns 503, and on 25 November 2026 that lasted long
 * enough that six models swept for forty seconds all failed. Nothing in this
 * repository can fix that.
 *
 * What it can do is make sure the questions a visitor actually asks have been
 * answered already. The four landing-page starters plus the obvious questions
 * about breaches, consent, CCTV and registration are not a guess -- the
 * starters are what the opening screen invites you to click.
 *
 * A degraded answer is never cached, so this script simply keeps asking until
 * the model is reachable. Run it, leave it, come back.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.argv[2] ?? 'https://privacyph.vercel.app').replace(/\/$/, '');
const questions = JSON.parse(readFileSync(join(root, 'docs/warm-questions.json'), 'utf8'));

const MAX_ATTEMPTS = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(question) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

console.log(`\nwarming ${questions.length} questions against ${base}\n`);

let cached = 0, fresh = 0, failed = 0;

for (const [i, question] of questions.entries()) {
  const label = `${String(i + 1).padStart(2)}/${questions.length}`;
  const short = question.length > 58 ? `${question.slice(0, 58)}…` : question;
  process.stdout.write(`${label}  ${short.padEnd(60)}`);

  let done = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !done; attempt++) {
    try {
      const data = await ask(question);

      if (data.cached) { console.log('already cached'); cached++; done = true; }
      else if (data.degraded) {
        // The point of the exercise: do not accept this, and do not cache it.
        const wait = Math.min(5000 * attempt, 20000);
        if (attempt === MAX_ATTEMPTS) { console.log('STILL BUSY — run again later'); failed++; done = true; }
        else { process.stdout.write(`busy, retrying in ${wait / 1000}s… `); await sleep(wait); }
      }
      else { console.log(data.insufficient ? 'cached (declined)' : 'cached'); fresh++; done = true; }
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) { console.log(`FAILED — ${err.message}`); failed++; done = true; }
      else { await sleep(3000 * attempt); }
    }
  }

  // Free tier allows roughly ten requests a minute; this keeps well under it.
  if (!done || fresh) await sleep(1500);
}

console.log(
  `\n  ${fresh} newly cached · ${cached} already cached · ${failed} still unavailable\n` +
    (failed ? '  Run again when the models are less busy.\n' : '  Every warmed question now answers without calling the model.\n')
);
process.exit(failed ? 1 : 0);
