/**
 * Fills the three credential values in .env.local by asking for them here,
 * in your terminal.
 *
 *   node scripts/setup-env.mjs            fill in whatever is missing
 *   node scripts/setup-env.mjs --rotate   re-ask for everything, set or not
 *
 * Nothing you type is printed back, and nothing leaves this machine. Each
 * value is shape-checked before it is written, so a half-copied key or a
 * leftover placeholder is caught now rather than six minutes into an ingest.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env.local');

if (!existsSync(envPath)) {
  console.error('No .env.local found. Copy .env.example to .env.local first.');
  process.exit(1);
}

const FIELDS = [
  {
    key: 'NEXT_PUBLIC_SUPABASE_URL',
    label: 'Supabase Project URL',
    where: 'Supabase dashboard > Project Settings > API > Data API',
    example: 'https://abcdefghijklmnop.supabase.co',
    check: (v) => /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v) || 'must look like https://xxxx.supabase.co',
    clean: (v) => v.replace(/\/$/, ''),
  },
  {
    key: 'SUPABASE_SERVICE_ROLE_KEY',
    secret: true,
    label: 'Supabase secret key (the NEW one, after rotating)',
    where: 'Supabase dashboard > Project Settings > API Keys > Secret keys',
    example: 'sb_secret_...',
    check: (v) =>
      v.startsWith('sb_secret_') || v.startsWith('eyJ') ||
      'should start with sb_secret_ (or eyJ on an older project)',
  },
  {
    key: 'LLM_API_KEY',
    secret: true,
    label: 'Google Gemini API key',
    where: 'https://aistudio.google.com/apikey',
    example: 'AQ.… or AIza…',
    // Google issues two shapes: the older AIza… keys and the newer AQ.… ones.
    // Accept both; rejecting a valid key is worse than accepting a typo, which
    // the first API call will catch anyway.
    check: (v) =>
      /^(AQ\.|AIza)/.test(v) || 'a Gemini key starts with AQ. or AIza',
  },
];

const PLACEHOLDER = /^$|^<|placeholder|your[-_ ]|api key$|galing sa rotation/i;

// Rotating a credential means replacing a value that is already present, so
// "skip anything already set" — correct for first-time setup — is exactly
// wrong here. Without this flag the script silently keeps the key you are
// trying to retire.
const rotate = process.argv.includes('--rotate');

const rl = createInterface({ input: stdin, output: stdout });

/**
 * Reads a value without echoing it. Used for every prompt.
 *
 * The first version of this script printed every character as it was typed,
 * which put the key into the terminal scrollback — and from there into every
 * screenshot and pasted block of output. Three credentials leaked that way
 * before anyone noticed, and each rotation re-exposed its replacement.
 *
 * Asking the user to be careful does not fix that. Not echoing does. A prompt
 * that takes a secret should never print it back.
 */
async function askHidden(prompt) {
  stdout.write(prompt);
  const restore = rl._writeToOutput;
  rl._writeToOutput = () => {};
  const answer = await rl.question('');
  rl._writeToOutput = restore;
  stdout.write('\n');
  return answer;
}
let env = readFileSync(envPath, 'utf8');
let changed = 0;

console.log(
  rotate
    ? '\nRotating .env.local — press Enter to keep the current value.\n'
    : '\nFilling in .env.local — press Enter to skip any field.\n'
);

for (const field of FIELDS) {
  const current = env.match(new RegExp(`^${field.key}=(.*)$`, 'm'))?.[1]?.trim() ?? '';

  if (current && !PLACEHOLDER.test(current) && !rotate) {
    console.log(`  ${field.key} — already set, skipping (--rotate to replace)`);
    continue;
  }

  if (current && !PLACEHOLDER.test(current)) {
    // Never print the tail of a secret either — that was the other leak.
    console.log(
      field.secret
        ? `\n${field.key} is currently set (${current.length} characters)`
        : `\n${field.key} currently ends in …${current.slice(-6)}`
    );
  }

  console.log(`\n${field.label}`);
  console.log(`  where: ${field.where}`);
  console.log(`  looks like: ${field.example}`);

  for (let tries = 0; tries < 3; tries++) {
    // Every field reads hidden, including the ones that hold nothing secret.
    //
    // Masking only the fields known to be secret is not enough: a key pasted
    // into the wrong prompt is echoed by whichever field it landed in. That
    // happened — two freshly created keys were burned by being pasted into
    // the Project URL prompt, which had no reason to hide anything and so
    // printed both. The prompt cannot know what the user is about to paste,
    // so none of them print.
    const answer = (await askHidden('  paste it here (input hidden): ')).trim();

    if (!answer) {
      console.log('  skipped.');
      break;
    }
    if (PLACEHOLDER.test(answer)) {
      console.log('  that is still the placeholder text, not a value. Try again.');
      continue;
    }

    if (!field.secret && /^(sb_secret_|AQ\.|AIza|eyJ)/.test(answer)) {
      console.log(
        '  that looks like an API key, and this field is not one. Nothing was\n' +
        '  printed or saved — treat that key as still safe and paste it at the\n' +
        '  right prompt.'
      );
      continue;
    }

    const verdict = field.check(answer);
    if (verdict !== true) {
      // Never echo the rejected value; it may be a secret in the wrong place.
      console.log(`  that does not look right — ${verdict}`);
      continue;
    }

    const value = field.clean ? field.clean(answer) : answer;
    env = env.replace(new RegExp(`^${field.key}=.*$`, 'm'), `${field.key}=${value}`);
    console.log('  saved.');
    changed++;
    break;
  }
}

rl.close();

if (changed) writeFileSync(envPath, env);

console.log('\n--- .env.local status ---');
let missing = 0;
for (const { key } of FIELDS) {
  const v = env.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
  const ok = v && !PLACEHOLDER.test(v);
  if (!ok) missing++;
  console.log(`  ${ok ? 'set    ' : 'MISSING'}  ${key}`);
}

console.log(
  missing
    ? `\n${missing} still missing. Run this again when you have them.`
    : '\nAll set. Next: npm run ingest'
);
