# PrivacyPH — Data Privacy Act Compliance Assistant

A retrieval-augmented assistant that answers Philippine data privacy
compliance questions for small and medium businesses, with a citation to the
governing issuance on every statement — and a refusal when the corpus does not
contain the answer.

Built because SMEs here carry real obligations under RA 10173 but rarely have
a data privacy lawyer or a full-time DPO, and the questions they ask are
repetitive and answerable from public text.

> Corpus verified: 23 November 2026 · 25 issuances · 548 indexed sections

---

## What it does

**1. Grounded Q&A.** Section-level retrieval over RA 10173, its IRR, and
current NPC circulars and advisories. The model answers only from retrieved
text and cites it inline as `[NPC-16-03, RULE V, SECTION 18]`. When the
retrieved context does not answer the question, it says so and cites nothing.

**2. Breach notification wizard.** Guided intake that applies the three-element
notification test, computes the 72-hour deadline, flags the cases where no
postponement is permitted, and drafts a notification with the four required
parts. No model call — pure logic, 11 unit tests, answers in under a second.

**3. Compliance scorecard.** *(planned)* Questions across five dimensions,
scored per dimension with a prioritised gap list.

## Results

Measured by `npm run eval` against `eval/questions.csv`. Raw per-question
output is committed under `eval/results/`.

| Metric | Result | Notes |
|---|---|---|
| Retrieval accuracy | **100%** (14/14) | Expected issuance present in the retrieved set |
| Top-1 accuracy | **57.1%** (8/14) | Expected issuance ranked first |
| Refusal accuracy | 1/1 scored | Out-of-corpus questions correctly declined |
| Unit tests | 19 passing | Breach logic and chunker |
| Type errors | 0 | `tsc --noEmit` clean |

**The 100% needs a caveat, and the caveat matters more than the number.** The
14 questions are self-authored and several name the circular they are looking
for, which makes them closer to lookups than to how a real DPO would ask. The
next version of this benchmark adds paraphrased questions that name no
document, and multi-hop questions that require two issuances to answer. A
benchmark you wrote yourself is a floor, not a score.

### What the similarity distribution showed

| | Cosine similarity |
|---|---|
| On-topic questions | 0.646 – 0.792 |
| Deliberately off-topic controls | 0.579 – 0.607 |

An off-topic question scored 0.579 against a data privacy corpus. On a corpus
where every document shares the same legal and governmental register, cosine
similarity alone separates relevant from irrelevant by about 0.04 — too thin
a margin to set a threshold on with this sample size.

So `MIN_SIMILARITY` is a backstop, not the defence. The model-level
`INSUFFICIENT_CONTEXT` check is what actually prevents fabricated answers, and
the eval reports both paths separately because they fail independently.

## Design decisions worth defending

**Section-aware chunking with a fallback strategy.** Fixed-size chunking cuts
across section boundaries, which is particularly destructive on statutes: a
question about the 72-hour notification window should retrieve one whole
section, not the tail of one and the head of another. `src/lib/chunk.ts`
splits on the structural markers these issuances use (`RULE V`, `SECTION 18`,
`Sec. 3`). Two of the 25 documents — the 2017-era advisories — carry no section
numbers at all, only bare title lines, so when the marker pass finds too few
sections to be believable, a heading pass runs instead. Measured across the
corpus: 23 documents parse by marker, 2 by heading.

**Running heads are stripped before chunking.** PDF extraction repeats the
document title and date on every page. Left in, they land inside section
bodies and let a query match a page header rather than the provision it was
looking for.

**Supersession is passed as context, not retrieved.** `match_chunks` filters
out issuances that have been replaced — correct for "what are the rules", and
exactly what makes "is the 2020 CCTV advisory still in force?" unanswerable,
since only the filtered-out rows can answer it. The replacement table is three
rows that change about once a year, so it is cached and passed with every
prompt. The data was always in the database; it just never reached the model.

**Graceful degradation when generation fails.** Retrieval and generation fail
independently. When every generation model is unavailable — routine on a free
tier — the retrieval result is still correct, so the assistant returns the full
text of the governing provisions with their citations instead of an error. On
a legal question the source text is arguably the better answer anyway.

**Superseded issuances are kept, not deleted.** `is_current = false` with
`superseded_by` set, filtered out of retrieval but preserved in the record.
Deleting them would throw away the audit trail.

**No citations behind a refusal.** An honest refusal and a confident answer are
both just text to the server. Attaching a Sources list to "I do not have this"
implies those sources support something. The model emits an explicit marker,
and the server suppresses citations when it sees it.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend + API | Next.js 15 (App Router), TypeScript | One deployable unit; API routes keep keys server-side |
| Database + vectors | Supabase Postgres + pgvector | One store for corpus, embeddings and logs |
| Auth | Supabase Auth with RLS | Row-level policies; see `supabase/schema.sql` |
| Embeddings | `gemini-embedding-001` at 1536 dimensions | Matryoshka output sizing matches `vector(1536)` |
| Generation | Gemini, native endpoint, model fallback chain | Free tier; chain ordered by measurement |

## Setup

```bash
npm install
cp .env.example .env.local
npm run setup-env          # prompts for the three credentials
```

1. Create a Supabase project. Run `supabase/schema.sql`, then
   `supabase/grants.sql`, in the SQL Editor.
2. `npm run fetch-corpus` — downloads 24 of the 25 PDFs. RA 10173 is served
   from behind Cloudflare and must be saved by hand; the script prints the link.
3. `npm run ingest` — chunks, embeds and loads the corpus (~6 minutes).
4. `npm run dev` — http://localhost:3000

Useful while working:

```bash
npm test                                           # 19 unit tests
npm run eval                                       # retrieval benchmark
node scripts/inspect-chunks.mjs                    # chunking report, no API cost
node --env-file=.env.local scripts/list-models.mjs # what the key can actually use
node --env-file=.env.local scripts/probe-gemini.mjs
```

`scripts/inspect-chunks.mjs` is the one to reach for first when retrieval looks
wrong: it reports sections per document and flags any document the chunker
failed to understand, without spending a single embedding call.

## Corpus

25 issuances, listed with their sources in `docs/corpus-sources.md`, which is
generated from `docs/corpus.json`. The PDFs themselves are not committed —
every one is public and re-fetchable with `npm run fetch-corpus`.

Includes RA 10173 and its IRR; the breach management, security, consent,
legitimate interest, administrative fines, registration, CCTV, identification
card, data sharing and loan-related circulars; and advisories on deceptive
design patterns, cross-border transfers, AI systems processing personal data,
data scraping, DPO designation and privacy impact assessments. Three superseded
issuances are retained with their replacements recorded.

## Limitations

- General information, not legal advice. The UI says so on every page.
- The corpus is a snapshot. Amendments to RA 10173 have been pending in
  Congress across several sessions, and the NPC issues new circulars regularly.
- The benchmark is 16 questions and self-authored. See the caveat above.
- Answer correctness is scored by hand. An LLM judge would need validating
  against the manual scores before it could be trusted.
- Free-tier generation is frequently rate-limited; the degradation path exists
  because of it.
- Not built for real client data. RLS confines users to their own rows, but
  this has had no security review.

## Before deploying

- [ ] **Rotate both credentials.** The Supabase secret key and the Gemini API
      key used during development were pasted into a chat and a screenshot
      while setting this up. Create replacements, update `.env.local` via
      `npm run setup-env`, delete the old ones, and do not paste or screenshot
      the new values anywhere.
- [ ] Run the Supabase security advisor and confirm RLS is reported clean on
      all six tables.
- [ ] Confirm `.env.local` is untracked: `git status --porcelain .env.local`
      should print nothing.
- [ ] Set the same environment variables in Vercel; none of the secret ones
      prefixed `NEXT_PUBLIC_`.
- [ ] Free Supabase projects pause after a week of inactivity. Decide how the
      demo stays awake, or note the wake-up delay in the project description.

## Roadmap

- [ ] Expand the benchmark: paraphrased questions, multi-hop questions, a
      Tagalog subset scored separately
- [ ] Admin dashboard: query volume, unanswered questions, feedback, confidence
      distribution
- [ ] Compliance scorecard across five dimensions
- [ ] Breach wizard PDF export
- [ ] A/B the newer `gemini-embedding-2` against `gemini-embedding-001` —
      re-ingest in full and compare retrieval accuracy, since vectors from
      different models are not comparable
- [ ] LLM-as-judge for answer correctness, validated against the manual scores
