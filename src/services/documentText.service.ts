import fs from "fs/promises";
import path from "path";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import logger from "../utils/logger";

const MAX_INDEXED_CHARS = 80_000;

const normalizeExtractedText = (text: string): string =>
  text.replace(/\s+/g, " ").trim().slice(0, MAX_INDEXED_CHARS);

export const extractTextFromFile = async (
  filePath: string,
  mimeType: string,
): Promise<string> => {
  try {
    const ext = path.extname(filePath).toLowerCase();

    if (mimeType === "application/pdf" || ext === ".pdf") {
      const buffer = await fs.readFile(filePath);
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return normalizeExtractedText(result.text || "");
      } finally {
        await parser.destroy();
      }
    }

    if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      ext === ".docx"
    ) {
      const result = await mammoth.extractRawText({ path: filePath });
      return normalizeExtractedText(result.value || "");
    }

    if (
      mimeType.startsWith("text/") ||
      [".csv", ".tsv", ".md", ".json", ".txt"].includes(ext)
    ) {
      const text = await fs.readFile(filePath, "utf8");
      return normalizeExtractedText(text);
    }
  } catch (error) {
    logger.warn(`Unable to extract text from ${filePath}`, error);
  }

  return "";
};
