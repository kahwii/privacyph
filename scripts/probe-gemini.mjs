/**
 * Sends the same tiny prompt to both Gemini endpoints and reports what each
 * does.
 *
 *   node --env-file=.env.local scripts/probe-gemini.mjs
 *
 * Written because every model in the fallback chain returned 503 while
 * embeddings on the same key worked perfectly. When one transport fails and
 * another succeeds with the same credential, the transport is the suspect —
 * not the thing it carries.
 */
const key = process.env.LLM_API_KEY;
const native = process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';
const compat = process.env.LLM_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai';
const models = (process.env.GENERATION_MODELS ?? 'gemini-3.8-flash').split(',').map((m) => m.trim());

const PROMPT = 'Reply with the single word: ok';

async function timed(label, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    console.log(`  ${label.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms  ${out}`);
    return true;
  } catch (err) {
    console.log(`  ${label.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms  ${err.message}`);
    return false;
  }
}

async function nativeCall(model) {
  const res = await fetch(`${native}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: PROMPT }] }] }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body.slice(0, 120).replace(/\s+/g, ' ')}`);
  const json = JSON.parse(body);
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  return `OK -> ${JSON.stringify(text.trim().slice(0, 40))}`;
}

async function compatCall(model) {
  const res = await fetch(`${compat}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: PROMPT }] }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body.slice(0, 120).replace(/\s+/g, ' ')}`);
  const json = JSON.parse(body);
  return `OK -> ${JSON.stringify((json.choices?.[0]?.message?.content ?? '').trim().slice(0, 40))}`;
}

console.log('\nnative  ' + native);
console.log('compat  ' + compat + '\n');

let nativeWins = 0;
let compatWins = 0;

for (const model of models) {
  console.log(model);
  if (await timed('native  :generateContent', () => nativeCall(model))) nativeWins++;
  if (await timed('compat  /chat/completions', () => compatCall(model))) compatWins++;
}

console.log(`\nnative succeeded on ${nativeWins}/${models.length}, compat on ${compatWins}/${models.length}`);
if (nativeWins > compatWins) console.log('Use the native endpoint for generation.');
else if (compatWins > nativeWins) console.log('Compat is healthier; the models themselves are fine.');
else console.log('Both behave the same — the problem is not the transport.');
