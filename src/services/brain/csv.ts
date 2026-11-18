import { parse } from "csv-parse/sync";

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 20000;

export type CsvErrorCode = "TOO_MANY_ROWS" | "MALFORMED" | "EMPTY" | "FILE_TOO_LARGE";

export class CsvError extends Error {
  readonly code: CsvErrorCode;

  constructor(code: CsvErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CsvError";
    this.code = code;
    Object.setPrototypeOf(this, CsvError.prototype);
  }
}

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  /** 1-based file line on which each data row starts (header is line 1). */
  lines: number[];
}

interface RecordWithInfo {
  record: string[];
  info: { lines: number };
}

export const parseCsvWithLines = (text: string): ParsedCsv => {
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) {
    throw new CsvError("FILE_TOO_LARGE", "CSV file exceeds 10 MB");
  }
  let records: RecordWithInfo[];
  try {
    // csv-parse miscounts lines for CRLF files; normalize so line tracking is exact.
    records = parse(text.replace(/\r\n/g, "\n"), {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
      info: true,
    }) as unknown as RecordWithInfo[];
  } catch {
    throw new CsvError("MALFORMED", "CSV could not be parsed (check quoting and column counts)");
  }
  if (records.length === 0) throw new CsvError("EMPTY", "CSV file is empty");
  if (records.length - 1 > MAX_CSV_ROWS) {
    throw new CsvError("TOO_MANY_ROWS", `CSV has more than ${MAX_CSV_ROWS} data rows`);
  }
  const startLine = ({ record, info }: RecordWithInfo): number => {
    let embedded = 0;
    for (const cell of record) {
      for (const ch of cell) if (ch === "\n") embedded += 1;
    }
    return info.lines - embedded;
  };
  return {
    header: records[0].record,
    rows: records.slice(1).map((r) => r.record),
    lines: records.slice(1).map(startLine),
  };
};

export const parseCsv = (text: string): { header: string[]; rows: string[][] } => {
  const { header, rows } = parseCsvWithLines(text);
  return { header, rows };
};
