/**
 * Lists the models this API key can actually use.
 *
 *   node --env-file=.env.local scripts/list-models.mjs
 *
 * Guessing model names from documentation wastes a round trip each time a
 * name has been retired. Ask the API instead, then set GENERATION_MODELS from
 * what it reports.
 */
const key = process.env.LLM_API_KEY;
const base = process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';

if (!key) {
  console.error('LLM_API_KEY is not set. Run with --env-file=.env.local');
  process.exit(1);
}

const res = await fetch(`${base}/models?pageSize=200`, {
  headers: { 'x-goog-api-key': key },
});

if (!res.ok) {
  console.error(`ListModels failed: HTTP ${res.status}`);
  console.error((await res.text()).slice(0, 400));
  process.exit(1);
}

const { models = [] } = await res.json();

const can = (m, method) => (m.supportedGenerationMethods ?? []).includes(method);
const name = (m) => m.name.replace(/^models\//, '');

const generators = models.filter((m) => can(m, 'generateContent')).map(name);
const embedders = models
  .filter((m) => can(m, 'embedContent') || can(m, 'batchEmbedContents'))
  .map(name);

console.log(`\nGENERATION (${generators.length})`);
for (const m of generators) console.log('  ' + m);

console.log(`\nEMBEDDING (${embedders.length})`);
for (const m of embedders) console.log('  ' + m);

/**
 * Suggest a chain for plain text generation.
 *
 * Excludes anything built for another modality — tts, image, audio, omni,
 * transcribe, robotics, research — which all appear in this list and none of
 * which answer a chat completion. Orders by version, newest first, and sinks
 * the lite variants to the end: they are weaker but far less contended, which
 * is exactly what you want from a last resort.
 *
 * Being listed here is not a promise. A model can appear in ListModels and
 * still answer 404 "no longer available to new users" — which is why the
 * chain exists rather than a single name.
 */
const EXCLUDE = /tts|image|audio|live|omni|transcribe|robotics|computer-use|deep-research|antigravity|lyria|nano-banana|gemma|preview|customtools/;

const version = (m) => Number((m.match(/(\d+(?:\.\d+)?)/) ?? [0, 0])[1]);

const chain = generators
  .filter((m) => /flash/.test(m) && !EXCLUDE.test(m))
  .sort((a, b) => {
    const lite = Number(/lite/.test(a)) - Number(/lite/.test(b));
    return lite !== 0 ? lite : version(b) - version(a);
  });

if (chain.length) {
  console.log('\nSuggested line for .env.local:');
  console.log('GENERATION_MODELS=' + chain.slice(0, 6).join(','));
}
