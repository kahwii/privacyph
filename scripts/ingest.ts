/**
 * Corpus ingestion.
 *
 *   1. Put the source PDFs in ./corpus/ using the file names in
 *      docs/corpus-sources.md.
 *   2. npm run ingest
 *
 * Re-running replaces the chunks for any document whose short_code is
 * already present, so fixing a chunking bug is a one-command redo.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { chunkLegalText } from '../src/lib/chunk';
import { embedBatch } from '../src/lib/llm';
import { serviceClient } from '../src/lib/supabase';

interface Source {
  shortCode: string;
  title: string;
  issuer: string;
  docType: 'statute' | 'irr' | 'circular' | 'advisory' | 'eo';
  dateIssued?: string;
  dateInForce?: string;
  sourceUrl: string;
  fallbackUrls?: string[];
  file: string;
  /** Defaults to true. Set false for an issuance that has been replaced. */
  isCurrent?: boolean;
  /** short_code of the issuance that replaced this one. */
  supersededBy?: string;
}

const CORPUS: Source[] = JSON.parse(
  readFileSync(join(process.cwd(), 'docs/corpus.json'), 'utf8')
);

const BATCH = 32;

async function main() {
  const db = serviceClient();

  for (const src of CORPUS) {
    const path = join(process.cwd(), 'corpus', src.file);
    if (!existsSync(path)) {
      console.warn(`skip ${src.shortCode}: ${src.file} not found in ./corpus`);
      continue;
    }

    const { text } = await pdf(readFileSync(path));
    const chunks = chunkLegalText(text);
    if (chunks.length === 0) {
      console.warn(`skip ${src.shortCode}: chunker produced nothing — check the PDF`);
      continue;
    }

    const { data: doc, error: docErr } = await db
      .from('documents')
      .upsert(
        {
          short_code: src.shortCode,
          title: src.title,
          issuer: src.issuer,
          doc_type: src.docType,
          date_issued: src.dateIssued ?? null,
          date_in_force: src.dateInForce ?? null,
          source_url: src.sourceUrl,
          is_current: src.isCurrent !== false,
          superseded_by: src.supersededBy ?? null,
        },
        { onConflict: 'short_code' }
      )
      .select('id')
      .single();

    if (docErr || !doc) {
      console.error(`${src.shortCode}: ${docErr?.message}`);
      continue;
    }

    await db.from('chunks').delete().eq('document_id', doc.id);

    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      const embeddings = await embedBatch(slice.map((c) => c.content));

      const { error } = await db.from('chunks').insert(
        slice.map((c, j) => ({
          document_id: doc.id,
          section_label: c.sectionLabel,
          heading: c.heading,
          content: c.content,
          token_count: Math.ceil(c.content.length / 4),
          ordinal: c.ordinal,
          embedding: embeddings[j],
        }))
      );

      if (error) console.error(`${src.shortCode} batch ${i}: ${error.message}`);
    }

    console.log(`${src.shortCode}: ${chunks.length} sections ingested`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
