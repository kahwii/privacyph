/**
 * Section-aware chunking for Philippine legal text.
 *
 * Fixed-size chunking cuts across section boundaries, which destroys
 * retrieval quality on statutes: a question about the 72-hour notification
 * window should return one whole section, not half of two.
 *
 * Two structures appear in the corpus, so there are two strategies:
 *
 *   marker  — numbered sections ("RULE V", "SECTION 18", "Sec. 3"). Used by
 *             the Act, the IRR, and every circular.
 *   heading — bare title lines ("Scope", "Definition of Terms"). Used by the
 *             2017-era advisories, which carry no section numbers at all.
 *
 * The marker pass runs first. If it finds too few sections to be believable,
 * the heading pass runs and the better result wins. Measured over 24
 * documents: 22 parse by marker, 2 by heading.
 */

export interface RawChunk {
  sectionLabel: string;
  heading: string | null;
  content: string;
  ordinal: number;
}

const MAX_CHARS = 4000;          // ~1000 tokens; safe for the embedding model
const MAX_HEADING = 80;          // a "title" longer than this is body text
const MIN_MARKER_SECTIONS = 5;   // below this, distrust the marker pass
const FURNITURE_REPEATS = 3;     // a short line this often is a running head

const SECTION_PATTERNS = [
  /^\s*(RULE\s+[IVXL]+)\s*[.–-]?\s*(.*)$/i,
  /^\s*(CHAPTER\s+[IVXL0-9]+)\s*[.–-]?\s*(.*)$/i,
  /^\s*(SECTION\s+\d+[A-Za-z]?)\s*[.–-]?\s*(.*)$/i,
  /^\s*(SEC\.?\s*\d+[A-Za-z]?)\s*[.–-]?\s*(.*)$/i,
];

/** A heading continued onto a second line usually opens with one of these. */
const CONTINUATION = /^(and|or|of|for|to|in|with|relative|under|from|on|by|the)\b/i;

/** A line ending on one of these is a wrapped sentence, not a title. */
const DANGLING = /\b(of|the|and|or|to|in|for|a|an|with|that|is|be|as|by|on|at|from|its|their)$/i;

function squash(s: string): string {
  return s.replace(/[ \t ]+/g, ' ').trim();
}

/**
 * Drops running heads, footers and bare page numbers.
 *
 * PDF extraction repeats the document title and date on every page. Left in,
 * they land inside section bodies, bloat the embedding, and let a query match
 * a page header rather than the provision it was looking for.
 */
function stripPageFurniture(text: string): string {
  const lines = text.split(/\r?\n/);
  const counts = new Map<string, number>();

  for (const line of lines) {
    const n = squash(line);
    if (n && n.length <= 90) counts.set(n, (counts.get(n) ?? 0) + 1);
  }

  return lines
    .filter((line) => {
      const n = squash(line);
      if (!n) return true;
      if (/^\d{1,3}$/.test(n)) return false;
      if (/^page\s+\d+/i.test(n)) return false;
      return (counts.get(n) ?? 0) < FURNITURE_REPEATS;
    })
    .join('\n');
}

interface Hit {
  label: string;
  heading: string;
  body: string;
  container: boolean;
}

/**
 * PDF extraction usually puts the section label, its short title, and the
 * opening of the body on one line:
 *
 *   "Sec. 18. When notification should be done. The Commission and affected..."
 *
 * So the remainder after the label is split at the first period, and only a
 * short leading fragment is treated as the heading.
 */
function matchMarker(line: string): Hit | null {
  for (const re of SECTION_PATTERNS) {
    const m = line.match(re);
    if (!m) continue;

    const label = squash(m[1]);
    const rest = squash(m[2] ?? '');
    const dot = rest.indexOf('.');
    const hasTitle = dot > 0 && dot <= MAX_HEADING;

    return {
      label,
      heading: hasTitle ? squash(rest.slice(0, dot)) : '',
      body: hasTitle ? squash(rest.slice(dot + 1)) : rest,
      container: /^(RULE|CHAPTER)/i.test(label),
    };
  }
  return null;
}

function matchHeading(line: string, next: string): Hit | null {
  const s = squash(line);

  if (s.length < 3 || s.length > 60) return null;
  if (!/^[A-Z]/.test(s)) return null;
  if (/[.;:,]$/.test(s)) return null;
  if (/^whereas/i.test(s)) return null;
  // "DATE : 14 MARCH 2017", "SUBJECT : ..." are metadata, not titles.
  if (s.includes(":")) return null;
  if (/^\d/.test(s)) return null;
  if (DANGLING.test(s)) return null;
  if (s.split(/\s+/).length > 8) return null;
  // A title introduces prose; if nothing follows it, this is a signature
  // block or a stray fragment. "next" is the next NON-BLANK line: these PDFs
  // put a blank line under every heading.
  if (!squash(next)) return null;

  return { label: s, heading: s, body: '', container: false };
}

function nextNonBlank(lines: string[], from: number): string {
  for (let i = from + 1; i < lines.length; i++) {
    const s = squash(lines[i]);
    if (s) return s;
  }
  return '';
}

/**
 * Splits a section that exceeds the embedding cap.
 *
 * Paragraph boundaries are preferred. A single paragraph past the cap is split
 * on sentence ends, and anything still too long is hard-split by length —
 * enumerations and tables in these PDFs sometimes arrive as one unbroken run
 * with no sentence ends at all, and an oversized chunk is silently truncated
 * by the embedding model rather than rejected, which is the worst outcome.
 */
function splitLong(chunk: RawChunk): RawChunk[] {
  if (chunk.content.length <= MAX_CHARS) return [chunk];

  const units: string[] = [];

  for (const paragraph of chunk.content.split(/\n\s*\n/)) {
    if (paragraph.length <= MAX_CHARS) {
      if (paragraph.trim()) units.push(paragraph.trim());
      continue;
    }

    let buf = "";
    for (const sentence of paragraph.split(/(?<=[.;:])\s+/)) {
      for (let i = 0; i < sentence.length; i += MAX_CHARS) {
        const piece = sentence.slice(i, i + MAX_CHARS);
        if (buf.length + piece.length + 1 > MAX_CHARS) {
          if (buf.trim()) units.push(buf.trim());
          buf = "";
        }
        buf += piece + " ";
      }
    }
    if (buf.trim()) units.push(buf.trim());
  }

  const parts: RawChunk[] = [];
  let buffer = "";
  let part = 1;

  const flush = () => {
    if (!buffer.trim()) return;
    parts.push({
      ...chunk,
      sectionLabel: `${chunk.sectionLabel} (${part})`,
      content: buffer.trim(),
    });
    part += 1;
    buffer = "";
  };

  for (const unit of units) {
    if (buffer.length + unit.length > MAX_CHARS) flush();
    buffer += `${unit}\n\n`;
  }
  flush();

  return parts.length ? parts : [chunk];
}

function collect(text: string, strategy: 'marker' | 'heading'): RawChunk[] {
  const lines = text.split(/\r?\n/);
  const chunks: RawChunk[] = [];

  let container = '';
  let current: RawChunk | null = null;
  let ordinal = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Annotated explicitly: the heading branch reads `current`, which this
    // same expression assigns to, and TypeScript cannot infer a type that
    // depends on itself.
    const hit: Hit | null =
      strategy === 'marker'
        ? matchMarker(line)
        : // A continuation line belongs to the heading above it, not to a new
          // section of its own.
          current && CONTINUATION.test(squash(line)) && squash(line).length <= 60
          ? null
          : matchHeading(line, nextNonBlank(lines, i));

    if (hit?.container) {
      container = hit.label;
      continue;
    }

    if (hit) {
      if (current) chunks.push(current);
      current = {
        sectionLabel: container ? `${container}, ${hit.label}` : hit.label,
        heading: hit.heading || null,
        // The heading is repeated into the content so the embedded text is
        // self-describing: a query about "notification deadline" should match
        // the section whose title says so.
        content: [hit.heading, hit.body].filter(Boolean).join('. ') + '\n',
        ordinal: ordinal++,
      };
      continue;
    }

    const cleaned = squash(line);

    if (current) {
      current.content += cleaned ? `${cleaned}\n` : '\n';
    } else if (cleaned) {
      current = {
        sectionLabel: 'Preamble',
        heading: null,
        content: `${cleaned}\n`,
        ordinal: ordinal++,
      };
    }
  }

  if (current) chunks.push(current);
  return chunks.filter((c) => c.content.trim().length > 120);
}

export function chunkLegalText(text: string): RawChunk[] {
  const cleaned = stripPageFurniture(text);

  const byMarker = collect(cleaned, 'marker');
  const chosen =
    byMarker.length >= MIN_MARKER_SECTIONS
      ? byMarker
      : (() => {
          const byHeading = collect(cleaned, 'heading');
          return byHeading.length > byMarker.length ? byHeading : byMarker;
        })();

  return chosen.flatMap(splitLong).map((c, i) => ({ ...c, ordinal: i }));
}
