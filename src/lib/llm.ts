/**
 * Embeddings and generation, across two providers.
 *
 * Generation goes through an OpenAI-compatible chat endpoint either way —
 * Gemini exposes one, so the same code path serves both.
 *
 * Embeddings do not. Gemini's native embed endpoint is used instead, because
 * it takes `outputDimensionality`, and that is what lets gemini-embedding-001
 * produce 1536-dimensional vectors to match `vector(1536)` in the schema
 * rather than its 3072-dimensional default. Google lists 3072, 1536 and 768
 * as the recommended sizes.
 */

import { applyDevDnsOverride } from './dns';
import { isDailyQuotaError } from './quota';

// Runs once, when this module is first loaded, before any request goes out.
applyDevDnsOverride();

type Provider = 'openai' | 'gemini';

const PROVIDER = (process.env.LLM_PROVIDER ?? 'openai') as Provider;
const API_KEY = process.env.LLM_API_KEY!;
const DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS ?? 1536);

const CHAT_BASE_URL = process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1';
const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
const GENERATION_MODEL = process.env.GENERATION_MODEL ?? 'gpt-4o-mini';

/** Gemini's embedding task types. Ignored by OpenAI, which has no equivalent. */
export type TaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

const MAX_RETRIES = 5;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * POST with retry on rate limiting and transient server errors. The free tier
 * is rate limited (100 requests per minute for embeddings), and a 548-chunk
 * ingest will hit that ceiling, so backing off is not optional.
 */
async function post(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  maxRetries = MAX_RETRIES,
  timeoutMs = 60_000
) {
  let lastError = '';

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.ok) return res.json();

    lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;

    // A 429 is two different failures wearing one status code. A per-minute
    // rate limit clears if you wait, so backing off is exactly right. A
    // per-day quota does not clear until tomorrow, and backing off four times
    // over it costs 15 seconds per model to learn what the first response
    // already said. On a free tier the second kind is the common one, and the
    // user watches the whole thing happen.
    const retryable =
      (res.status === 429 && !isDailyQuotaError(lastError)) || res.status >= 500;
    if (!retryable || attempt === maxRetries - 1) break;

    // 1s, 2s, 4s, 8s — enough to clear a per-minute window.
    await sleep(1000 * 2 ** attempt);
  }

  throw new Error(`${url.split('/').slice(-1)[0]} failed — ${lastError}`);
}

/**
 * Below 3072 dimensions, Gemini's vectors are not pre-normalised. Cosine
 * distance normalises internally so this is not strictly required today, but
 * unit vectors keep cosine and inner product in agreement — which matters the
 * moment anyone swaps the index to vector_ip_ops for speed.
 */
function normalise(v: number[]): number[] {
  const magnitude = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return magnitude > 0 ? v.map((x) => x / magnitude) : v;
}

export async function embed(
  text: string,
  taskType: TaskType = 'RETRIEVAL_QUERY'
): Promise<number[]> {
  const input = text.replace(/\s+/g, ' ').trim();

  if (PROVIDER === 'gemini') {
    const json = await post(
      `${GEMINI_BASE_URL}/models/${EMBEDDING_MODEL}:embedContent`,
      {
        content: { parts: [{ text: input }] },
        taskType,
        outputDimensionality: DIMENSIONS,
      },
      { 'x-goog-api-key': API_KEY }
    );
    return normalise(json.embedding.values);
  }

  const json = await post(
    `${CHAT_BASE_URL}/embeddings`,
    { model: EMBEDDING_MODEL, input, dimensions: DIMENSIONS },
    { Authorization: `Bearer ${API_KEY}` }
  );
  return json.data[0].embedding;
}

/**
 * Embeds several texts.
 *
 * OpenAI accepts an array in one request. gemini-embedding-001 takes one text
 * per request, so this loops — with a pause that keeps the free tier's 100
 * requests per minute in reach. Ingesting the whole corpus this way takes a
 * few minutes; that is the cost of the free tier, and it only runs on ingest.
 */
export async function embedBatch(
  texts: string[],
  taskType: TaskType = 'RETRIEVAL_DOCUMENT'
): Promise<number[][]> {
  if (PROVIDER === 'gemini') {
    const out: number[][] = [];
    for (const text of texts) {
      out.push(await embed(text, taskType));
      await sleep(650); // ~92 requests/minute, under the free-tier ceiling
    }
    return out;
  }

  const json = await post(
    `${CHAT_BASE_URL}/embeddings`,
    {
      model: EMBEDDING_MODEL,
      input: texts.map((t) => t.replace(/\s+/g, ' ').trim()),
      dimensions: DIMENSIONS,
    },
    { Authorization: `Bearer ${API_KEY}` }
  );
  return json.data.map((d: { embedding: number[] }) => d.embedding);
}

/** Overall budget for one answer. Past this, stop walking the chain. */
const GENERATION_BUDGET_MS = 45_000;
const PER_CALL_TIMEOUT_MS = 25_000;

/**
 * Calls Gemini's own generateContent endpoint.
 *
 * Generation used to go through Gemini's OpenAI-compatibility layer, for the
 * convenience of sharing one code path with OpenAI. That layer returned 503
 * "experiencing high demand" on every model in the chain — newest and oldest,
 * full-size and lite — while embeddings on the same key, through the native
 * endpoint, worked without a single failure. When one transport fails and
 * another succeeds on the same credential, the transport is the suspect.
 *
 * That hypothesis turned out to be wrong: scripts/probe-gemini.mjs sent the
 * same prompt through both transports and they behaved identically per model.
 * The real cause was per-model quota — the compatibility layer reported it as
 * 429 "exceeded your current quota" where the native endpoint reported the
 * same condition as 503 "high demand", and that difference in wording is what
 * sent the investigation the wrong way. The fix was to order the chain by what
 * actually answers.
 *
 * Generation stays on the native endpoint anyway: it is one fewer layer in the
 * request path, and it exposes finishReason and blockReason, which the compat
 * layer flattens into an empty string. It was not the bug, but it is still the
 * better default.
 */
async function generateNative(
  model: string,
  system: string,
  user: string,
  temperature: number
): Promise<string> {
  const json = await post(
    `${GEMINI_BASE_URL}/models/${model}:generateContent`,
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature },
    },
    { 'x-goog-api-key': API_KEY },
    2,
    PER_CALL_TIMEOUT_MS
  );

  // A blocked prompt returns 200 with no candidate, which would otherwise
  // surface as a blank answer in the UI.
  const blocked = json.promptFeedback?.blockReason;
  if (blocked) throw new Error(`prompt blocked: ${blocked}`);

  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? '')
    .join('')
    .trim();

  if (!text) {
    throw new Error(`empty completion (finishReason: ${candidate?.finishReason ?? 'none'})`);
  }
  return text;
}

async function generateCompat(
  model: string,
  system: string,
  user: string,
  temperature: number
): Promise<string> {
  const json = await post(
    `${CHAT_BASE_URL}/chat/completions`,
    {
      model,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
    { Authorization: `Bearer ${API_KEY}` },
    2,
    PER_CALL_TIMEOUT_MS
  );

  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('empty completion');
  return text;
}

/**
 * Generation, with a model fallback chain and an overall deadline.
 *
 * The deadline matters as much as the chain: six models times two tries times
 * a 60-second timeout once spent 192 seconds before telling the user it had
 * failed. A caller waiting on an answer would rather be told no in 45 seconds
 * than yes in three minutes — and a serverless function would have been killed
 * long before either.
 */
export async function generate(
  system: string,
  user: string,
  temperature = 0.1
): Promise<string> {
  const models = (process.env.GENERATION_MODELS ?? GENERATION_MODEL)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  const call = PROVIDER === 'gemini' ? generateNative : generateCompat;
  const deadline = Date.now() + GENERATION_BUDGET_MS;
  const failures: string[] = [];

  for (const model of models) {
    if (Date.now() > deadline) {
      failures.push('budget exhausted before trying ' + model);
      break;
    }

    try {
      const text = await call(model, system, user, temperature);
      if (failures.length) {
        console.warn(`[llm] ${model} answered after: ${failures.join(' | ')}`);
      }
      return text;
    } catch (err) {
      failures.push(`${model} — ${(err as Error).message.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }

  throw new Error('every generation model failed:\n  ' + failures.join('\n  '));
}
