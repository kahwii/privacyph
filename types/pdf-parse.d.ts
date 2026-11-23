/**
 * pdf-parse ships no types, and its package index runs a debug block when
 * loaded as an ES module, so the library file is imported directly. Only the
 * fields this project reads are declared.
 */
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }
  function pdf(data: Buffer | Uint8Array): Promise<PdfParseResult>;
  export default pdf;
}
