/**
 * Reports which environment values are set, and never asks for any of them.
 *
 *   node scripts/check-env.mjs
 *
 * This replaces an interactive prompt that read credentials from the
 * terminal. The prompt masked its input, which works on Linux and macOS and
 * does not work in PowerShell: the Windows console echoes pasted text itself,
 * before Node sees it. Four credentials were burned into terminal scrollback
 * and screenshots before that was clear.
 *
 * Masking harder was the wrong fix twice. A terminal is simply not a safe
 * place to type a secret on every platform, so this tool no longer offers to
 * take one — it tells you what is missing and leaves the editing to your
 * editor, where nothing is echoed and nothing is scrolled back.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env.local');

const FIELDS = [
  { key: 'NEXT_PUBLIC_SUPABASE_URL', secret: false, where: 'Supabase > Project Settings > API > Data API' },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', secret: false, where: 'Supabase > Project Settings > API Keys > Publishable key' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', secret: true, where: 'Supabase > Project Settings > API Keys > Secret keys' },
  { key: 'LLM_API_KEY', secret: true, where: 'https://aistudio.google.com/apikey' },
  { key: 'LLM_PROVIDER', secret: false, where: 'gemini or openai' },
  { key: 'EMBEDDING_MODEL', secret: false, where: 'gemini-embedding-001' },
  { key: 'EMBEDDING_DIMENSIONS', secret: false, where: 'must match vector(N) in schema.sql' },
  { key: 'GENERATION_MODELS', secret: false, where: 'node --env-file=.env.local scripts/list-models.mjs' },
];

const PLACEHOLDER = /^$|^<|placeholder|your[-_ ]|api key$/i;

if (!existsSync(envPath)) {
  console.error('\nNo .env.local. Copy .env.example to .env.local and fill it in.\n');
  process.exit(1);
}

const env = readFileSync(envPath, 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim();

console.log('\n.env.local\n');

const missing = [];

for (const f of FIELDS) {
  const v = get(f.key);
  const ok = v && !PLACEHOLDER.test(v);
  if (!ok) missing.push(f);

  // A secret is reported by length only. Printing a tail is how the last
  // leak started.
  const shown = !ok
    ? 'not set'
    : f.secret
      ? `set, ${v.length} characters`
      : v.length > 46
        ? `${v.slice(0, 46)}…`
        : v;

  console.log(`  ${ok ? ' ' : '!'} ${f.key.padEnd(30)} ${shown}`);
}

if (!missing.length) {
  console.log('\nAll set. Next: npm run dev\n');
  process.exit(0);
}

console.log(`\n${missing.length} value(s) missing. Open .env.local in your editor and paste them in:\n`);
for (const f of missing) {
  console.log(`  ${f.key}`);
  console.log(`      ${f.where}\n`);
}
console.log('Copy from the site, paste straight into the editor. Not through a');
console.log('terminal, a note-taking app, or a chat window — each of those keeps a');
console.log('copy you will forget about.\n');
