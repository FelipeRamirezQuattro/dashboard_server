import { CsvError, parseCsvWithLines } from "./csv";
import { checks, CheckFn } from "./datasetChecks";
import { ColumnDef, DatasetDefinition, ImportReport, RowIssue, TableDef } from "./types";

export { checks };
export type { CheckFn };

const NULL_TOKENS = new Set(["n/a", "-", "null"]);
const INTEGER_RE = /^-?\d+$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

type Coerced = { ok: true; value: unknown } | { ok: false; code: string; message: string };
const fail = (code: string, message: string): Coerced => ({ ok: false, code, message });
const pass = (value: unknown): Coerced => ({ ok: true, value });

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

const isRealDate = (y: number, m: number, d: number): boolean => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const checkRange = (col: ColumnDef, n: number, min = col.min, max = col.max): Coerced | null => {
  if (min !== undefined && n < min) return fail("OUT_OF_RANGE", `${col.name} must be >= ${min}`);
  if (max !== undefined && n > max) return fail("OUT_OF_RANGE", `${col.name} must be <= ${max}`);
  return null;
};

// Coerces one non-empty, trimmed cell.
const coerce = (col: ColumnDef, raw: string): Coerced => {
  const freeText = col.type === "string" || col.type === "text";
  if (!freeText && NULL_TOKENS.has(raw.toLowerCase())) {
    return fail("NULL_TOKEN", `${col.name}: "${raw}" is not allowed; leave the cell empty`);
  }
  const maxLength = col.maxLength ?? (col.type === "text" ? 4000 : undefined);
  if (maxLength !== undefined && raw.length > maxLength) {
    return fail("TOO_LONG", `${col.name} exceeds ${maxLength} characters`);
  }
  switch (col.type) {
    case "string":
    case "text":
      return pass(raw);
    case "integer": {
      if (!INTEGER_RE.test(raw)) return fail("INVALID_INTEGER", `${col.name} must be a whole number`);
      const n = Number(raw);
      return checkRange(col, n) ?? pass(n);
    }
    case "number": {
      if (!NUMBER_RE.test(raw)) return fail("INVALID_NUMBER", `${col.name} must be a number`);
      const n = Number(raw);
      return checkRange(col, n) ?? pass(n);
    }
    case "percent": {
      if (!NUMBER_RE.test(raw)) return fail("INVALID_NUMBER", `${col.name} must be a number`);
      const n = Number(raw);
      return checkRange(col, n, Math.max(0, col.min ?? 0), Math.min(100, col.max ?? 100)) ?? pass(n);
    }
    case "boolean":
      if (raw === "true") return pass(true);
      if (raw === "false") return pass(false);
      return fail("INVALID_BOOLEAN", `${col.name} must be exactly true or false`);
    case "date": {
      const m = DATE_RE.exec(raw);
      if (!m || !isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
        return fail("INVALID_DATE", `${col.name} must be a valid YYYY-MM-DD date`);
      }
      if (col.notFuture && raw > todayUtc()) return fail("FUTURE_DATE", `${col.name} must not be in the future`);
      return pass(raw);
    }
    case "enum": {
      if (!(col.values ?? []).includes(raw)) return fail("INVALID_ENUM", `${col.name}: "${raw}" is not an allowed value`);
      return pass(raw);
    }
    case "enum_list": {
      const items = raw.split(";").map((s) => s.trim());
      const allowed = col.values ?? [];
      for (const item of items) {
        if (!allowed.includes(item)) {
          return fail("INVALID_ENUM", `${col.name}: "${item}" is not an allowed value`);
        }
      }
      return pass(items);
    }
    default:
      return fail("UNSUPPORTED_TYPE", `${col.name} has an unsupported type`);
  }
};

interface Candidate {
  line: number;
  row: Record<string, unknown>;
}

interface TableState {
  table: TableDef;
  candidates: Candidate[];
  rowsRead: number;
  blocked: boolean;
}

const validateTable = (table: TableDef, text: string, issues: RowIssue[]): TableState => {
  const state: TableState = { table, candidates: [], rowsRead: 0, blocked: true };
  const fileIssue = (code: string, message: string, column?: string): void => {
    issues.push({ file: table.file, row: 0, column, severity: "reject", code, message });
  };

  let parsed;
  try {
    parsed = parseCsvWithLines(text);
  } catch (e) {
    if (e instanceof CsvError) fileIssue(e.code, e.message);
    else fileIssue("MALFORMED", "CSV could not be parsed");
    return state;
  }
  state.rowsRead = parsed.rows.length;

  const header = parsed.header.map((h) => h.trim().toLowerCase());
  const seen = new Set<string>();
  for (const h of header) {
    if (seen.has(h)) fileIssue("DUPLICATE_HEADER", `Duplicate column "${h}"`, h);
    seen.add(h);
  }
  const known = new Map(table.columns.map((c) => [c.name.toLowerCase(), c]));
  for (const col of table.columns) {
    if (col.required && !seen.has(col.name.toLowerCase())) fileIssue("MISSING_COLUMN", `Required column "${col.name}" is missing`, col.name);
  }
  for (const h of header) {
    if (!known.has(h)) fileIssue("UNKNOWN_COLUMN", `Unknown column "${h}"`, h);
  }
  if (issues.some((i) => i.file === table.file && i.row === 0)) return state;

  state.blocked = false;
  const keys = new Set<string>();
  parsed.rows.forEach((cells, idx) => {
    const line = parsed.lines[idx];
    const row: Record<string, unknown> = {};
    let rowOk = true;
    const reject = (col: string, code: string, message: string): void => {
      rowOk = false;
      issues.push({ file: table.file, row: line, column: col, severity: "reject", code, message });
    };
    header.forEach((name, ci) => {
      const col = known.get(name) as ColumnDef;
      const raw = (cells[ci] ?? "").trim();
      if (raw === "") {
        if (col.required) reject(col.name, "REQUIRED", `${col.name} is required`);
        return;
      }
      const result = coerce(col, raw);
      if (result.ok) row[col.name] = result.value;
      else reject(col.name, result.code, result.message);
    });
    if (rowOk && table.primaryKey.length > 0 && table.primaryKey.every((k) => row[k] !== undefined)) {
      const key = JSON.stringify(table.primaryKey.map((k) => row[k]));
      if (keys.has(key)) {
        reject(table.primaryKey[0], "DUPLICATE_KEY", `Duplicate primary key (${table.primaryKey.join(", ")})`);
      } else keys.add(key);
    }
    if (rowOk) state.candidates.push({ line, row });
  });
  return state;
};

export const validateDataset = (def: DatasetDefinition, files: Record<string, string>): ImportReport => {
  const issues: RowIssue[] = [];
  const states = new Map<string, TableState>();

  for (const table of def.tables) {
    const text = files[table.file];
    if (text === undefined) {
      if (table.required) {
        issues.push({
          file: table.file,
          row: 0,
          severity: "reject",
          code: "MISSING_FILE",
          message: `Required file ${table.file} was not provided`,
        });
        states.set(table.name, { table, candidates: [], rowsRead: 0, blocked: true });
      }
      continue;
    }
    states.set(table.name, validateTable(table, String(text), issues));
  }

  // References resolve against the rows that passed their own table's validation.
  const refValues = new Map<string, Set<string>>();
  const valuesOf = (tableName: string, column: string): Set<string> => {
    const cacheKey = `${tableName}\u0000${column}`;
    let set = refValues.get(cacheKey);
    if (!set) {
      set = new Set<string>();
      for (const c of states.get(tableName)?.candidates ?? []) {
        if (c.row[column] !== undefined) set.add(String(c.row[column]));
      }
      refValues.set(cacheKey, set);
    }
    return set;
  };
  const rowsByLine = new Map<string, Set<number>>();
  for (const state of states.values()) {
    const rejectedLines = new Set<number>();
    for (const ref of state.table.references) {
      const targets = valuesOf(ref.table, ref.refColumn);
      for (const c of state.candidates) {
        const v = c.row[ref.column];
        if (v === undefined || targets.has(String(v))) continue;
        rejectedLines.add(c.line);
        issues.push({
          file: state.table.file,
          row: c.line,
          column: ref.column,
          severity: "reject",
          code: "DANGLING_REFERENCE",
          message: `${ref.column} does not match any ${ref.refColumn} in ${ref.table}`,
        });
      }
    }
    rowsByLine.set(state.table.name, rejectedLines);
  }

  const rows: Record<string, Record<string, unknown>[]> = {};
  const report: ImportReport = {
    datasetKey: def.key,
    datasetVersion: def.version,
    files: {},
    issues,
    canCommit: false,
    rows,
  };
  for (const state of states.values()) {
    const dropped = rowsByLine.get(state.table.name) ?? new Set<number>();
    const accepted = state.candidates.filter((c) => !dropped.has(c.line)).map((c) => c.row);
    rows[state.table.name] = accepted;
    report.files[state.table.file] = {
      rowsRead: state.rowsRead,
      rowsAccepted: accepted.length,
      rowsRejected: state.rowsRead - accepted.length,
    };
  }

  // Cross-row checks run over accepted rows only.
  for (const state of states.values()) {
    for (const id of state.table.checks) {
      const fn = checks[id];
      try {
        if (!fn) throw new Error(`unknown check ${id}`);
        issues.push(...fn(rows, def));
      } catch {
        issues.push({
          file: state.table.file,
          row: 0,
          severity: "reject",
          code: "CHECK_FAILED",
          message: `Check "${id}" could not be run`,
        });
      }
    }
  }

  report.canCommit = !issues.some((i) => i.severity === "reject");
  return report;
};
