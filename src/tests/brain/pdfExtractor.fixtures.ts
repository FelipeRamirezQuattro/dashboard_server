/// <reference types="node" />
import fs from "fs";
import path from "path";
import { DocumentError } from "../../services/brain/documentParser";
import { extractPdfPages } from "../../services/brain/pdfExtractor";

const assert = (cond: unknown, message: string): void => {
  if (!cond) throw new Error(message);
};
const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
  } catch (err) {
    if (err instanceof DocumentError) return err.code;
    throw err;
  }
  return "NO_ERROR";
};
const load = (name: string): Buffer => fs.readFileSync(path.join(__dirname, "fixtures", name));

const main = async (): Promise<void> => {
  const pages = await extractPdfPages(load("two-pages.pdf"));
  assert(pages.length === 2, `expected 2 pages, got ${pages.length}`);
  assert(pages[0].page === 1 && /alpha/.test(pages[0].text) && !/beta/.test(pages[0].text), "page 1 should contain alpha only");
  assert(pages[1].page === 2 && /beta/.test(pages[1].text) && !/alpha/.test(pages[1].text), "page 2 should contain beta only");

  assert((await codeOf(() => extractPdfPages(load("blank.pdf")))) === "NO_EXTRACTABLE_TEXT", "blank => NO_EXTRACTABLE_TEXT");
  assert(
    (await codeOf(() => extractPdfPages(load("two-pages.pdf"), { maxPages: 1 }))) === "TOO_MANY_PAGES",
    "maxPages 1 => TOO_MANY_PAGES",
  );
  assert(
    (await codeOf(() => extractPdfPages(Buffer.from("this is not a pdf at all")))) === "INVALID_PDF",
    "garbage => INVALID_PDF",
  );
  assert(
    (await codeOf(() => extractPdfPages(Buffer.alloc(20 * 1024 * 1024 + 1)))) === "TOO_LARGE",
    "oversize => TOO_LARGE",
  );
  console.log("pdfExtractor fixtures OK");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
