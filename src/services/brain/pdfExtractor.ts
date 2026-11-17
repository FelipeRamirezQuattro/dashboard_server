import { PDFParse } from "pdf-parse";
import { DocumentError } from "./documentParser";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MAX_PDF_PAGES = 200;

export interface PdfPage {
  page: number;
  text: string;
}

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Extract per-page text from a text-based PDF. Page numbers are 1-based; blank pages
 * are omitted. No OCR: image-only PDFs yield NO_EXTRACTABLE_TEXT. Never logs content.
 */
export const extractPdfPages = async (
  buffer: Buffer,
  opts: { maxPages?: number } = {},
): Promise<PdfPage[]> => {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PDF_PAGES;
  if (buffer.length > MAX_PDF_BYTES) {
    throw new DocumentError("TOO_LARGE", "PDF exceeds the 20 MB limit.");
  }

  let parser: PDFParse | undefined;
  try {
    parser = new PDFParse({ data: new Uint8Array(buffer) });
    let total: number;
    let result;
    try {
      total = (await parser.getInfo()).total;
      if (total > maxPages) {
        throw new DocumentError("TOO_MANY_PAGES", `PDF has ${total} pages; the limit is ${maxPages}.`);
      }
      result = await parser.getText();
    } catch (err) {
      if (err instanceof DocumentError) throw err;
      throw new DocumentError("INVALID_PDF", "The file could not be read as a valid PDF.");
    }

    const pages: PdfPage[] = [];
    for (const p of result.pages) {
      const text = normalize(p.text || "");
      if (text.length > 0) pages.push({ page: p.num, text });
    }
    if (pages.length === 0) {
      throw new DocumentError(
        "NO_EXTRACTABLE_TEXT",
        "No extractable text found. Scanned or image-only PDFs are not supported (no OCR).",
      );
    }
    return pages;
  } finally {
    if (parser) await parser.destroy().catch(() => undefined);
  }
};
