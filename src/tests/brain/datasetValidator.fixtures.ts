import { CsvError, parseCsv } from "../../services/brain/csv";
import { checks } from "../../services/brain/datasetChecks";
import { validateDataset } from "../../services/brain/datasetValidator";
import { DatasetDefinition, ImportReport } from "../../services/brain/types";

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};
const cases: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void): void => {
  cases.push({ name, run });
};

const def: DatasetDefinition = {
  key: "test",
  version: "1",
  label: "Test",
  tables: [
    {
      name: "parents",
      file: "parents.csv",
      required: true,
      primaryKey: ["id"],
      columns: [
        { name: "id", type: "string", required: true },
        { name: "note", type: "text" },
      ],
      references: [],
      checks: [],
    },
    {
      name: "children",
      file: "children.csv",
      required: false,
      primaryKey: ["parent_id", "kind"],
      columns: [
        { name: "parent_id", type: "string", required: true },
        { name: "kind", type: "enum", required: true, values: ["a", "b"] },
        { name: "tags", type: "enum_list", values: ["x", "y", "z"] },
        { name: "count", type: "integer", min: 0, max: 100 },
        { name: "ratio", type: "number" },
        { name: "seen", type: "date", notFuture: true },
        { name: "flag", type: "boolean" },
        { name: "pct", type: "percent" },
        { name: "label", type: "string", maxLength: 5 },
      ],
      references: [{ column: "parent_id", table: "parents", refColumn: "id" }],
      checks: [],
    },
  ],
};

const CH = "parent_id,kind,tags,count,ratio,seen,flag,pct,label";
const run = (parents: string, children?: string, d: DatasetDefinition = def): ImportReport => {
  const files: Record<string, string> = { "parents.csv": parents };
  if (children !== undefined) files["children.csv"] = children;
  return validateDataset(d, files);
};
const P = "id,note\np1,hello\n";
const codes = (r: ImportReport): string[] => r.issues.map((i) => i.code);
const hasReject = (r: ImportReport, code: string): boolean =>
  r.issues.some((i) => i.code === code && i.severity === "reject");

test("BOM + CRLF parses and accepts", () => {
  const r = run("﻿id,note\r\np1,hi\r\n", `${CH}\r\np1,a,x;y,5,1.5,2020-01-02,true,50,abc\r\n`);
  assert(r.canCommit, `expected canCommit, got ${JSON.stringify(r.issues)}`);
  const row = r.rows.children[0];
  assert(row.count === 5 && row.ratio === 1.5 && row.flag === true && row.pct === 50, "coercion");
  assert(JSON.stringify(row.tags) === '["x","y"]', "enum_list coerced");
  assert(row.seen === "2020-01-02", "date kept as string");
});

test("quoted cell round-trips", () => {
  const parsed = parseCsv('a,b\n"a, ""b""\nc",2\n');
  assert(parsed.rows[0][0] === 'a, "b"\nc', "cell mismatch");
});

test("duplicate header rejected", () => {
  const r = run("id,id\np1,p1\n");
  assert(hasReject(r, "DUPLICATE_HEADER") && !r.canCommit, "DUPLICATE_HEADER");
  assert(r.issues[0].row === 0, "file-level row 0");
});

test("missing required header rejected", () => {
  const r = run("note\nhi\n");
  assert(hasReject(r, "MISSING_COLUMN") && !r.canCommit, "MISSING_COLUMN");
});

test("unknown header rejected", () => {
  const r = run("id,note,extra\np1,a,b\n");
  assert(hasReject(r, "UNKNOWN_COLUMN") && !r.canCommit, "UNKNOWN_COLUMN");
});

test("N/A in integer rejected NULL_TOKEN", () => {
  const r = run(P, `${CH}\np1,a,,N/A,,,,,\n`);
  assert(hasReject(r, "NULL_TOKEN"), "NULL_TOKEN");
});

test("N/A in text accepted", () => {
  const r = run("id,note\np1,N/A\n");
  assert(r.canCommit && r.rows.parents[0].note === "N/A", "text N/A accepted");
});

test("bad date rejected", () => {
  const r = run(P, `${CH}\np1,a,,,,2025-13-40,,,\n`);
  assert(hasReject(r, "INVALID_DATE"), "INVALID_DATE");
});

test("future date rejected with notFuture", () => {
  const r = run(P, `${CH}\np1,a,,,,2999-01-01,,,\n`);
  assert(hasReject(r, "FUTURE_DATE"), "FUTURE_DATE");
});

test("enum not in list rejected", () => {
  const r = run(P, `${CH}\np1,q,,,,,,,\n`);
  assert(hasReject(r, "INVALID_ENUM"), "INVALID_ENUM");
});

test("enum_list bad value names it", () => {
  const r = run(P, `${CH}\np1,a,x;bogus,,,,,,\n`);
  const issue = r.issues.find((i) => i.code === "INVALID_ENUM");
  assert(issue && issue.message.includes("bogus") && issue.severity === "reject", "names bogus");
});

test("duplicate primary key rejected on second row", () => {
  const r = run(P, `${CH}\np1,a,,,,,,,\np1,a,,,,,,,\n`);
  const issue = r.issues.find((i) => i.code === "DUPLICATE_KEY");
  assert(issue && issue.row === 3 && issue.file === "children.csv", "row 3");
  assert(r.rows.children.length === 1, "first kept");
});

test("primary key part containing | rejected with row and column", () => {
  const r = run("id,note\np1,ok\nx|y,bad\n");
  const issue = r.issues.find((i) => i.code === "PK_CONTAINS_SEPARATOR");
  assert(issue && issue.severity === "reject" && issue.row === 3 && issue.column === "id" && issue.file === "parents.csv", "PK_CONTAINS_SEPARATOR at row 3 column id");
  assert(r.rows.parents.length === 1 && !r.canCommit, "bad row dropped, no commit");
  const ok = run("id,note\np1,has|pipe in non-key\n");
  assert(!ok.issues.some((i) => i.code === "PK_CONTAINS_SEPARATOR"), "| in a non-key column is fine");
});

test("dangling reference rejected", () => {
  const r = run(P, `${CH}\nnope,a,,,,,,,\n`);
  assert(hasReject(r, "DANGLING_REFERENCE"), "DANGLING_REFERENCE");
});

test("percent 101 rejected", () => {
  const r = run(P, `${CH}\np1,a,,,,,,101,\n`);
  assert(hasReject(r, "OUT_OF_RANGE"), "OUT_OF_RANGE");
});

test("integer min/max and type", () => {
  assert(hasReject(run(P, `${CH}\np1,a,,101,,,,,\n`), "OUT_OF_RANGE"), "max");
  assert(hasReject(run(P, `${CH}\np1,a,,1.5,,,,,\n`), "INVALID_INTEGER"), "int type");
});

test("boolean exactly true/false", () => {
  assert(hasReject(run(P, `${CH}\np1,a,,,,,TRUE,,\n`), "INVALID_BOOLEAN"), "TRUE rejected");
});

test("maxLength and required", () => {
  assert(hasReject(run(P, `${CH}\np1,a,,,,,,,toolong\n`), "TOO_LONG"), "TOO_LONG");
  assert(hasReject(run(P, `${CH}\np1,,,,,,,,\n`), "REQUIRED"), "REQUIRED");
});

test("required file missing rejected", () => {
  const r = validateDataset(def, {});
  assert(hasReject(r, "MISSING_FILE") && !r.canCommit, "MISSING_FILE");
});

test("optional file missing is fine", () => {
  assert(run(P).canCommit, "canCommit");
});

test("20,001 rows throws TOO_MANY_ROWS", () => {
  const text = "a\n" + Array.from({ length: 20001 }, () => "x").join("\n");
  try {
    parseCsv(text);
  } catch (e) {
    assert(e instanceof CsvError && e.code === "TOO_MANY_ROWS", "code");
    return;
  }
  throw new Error("did not throw");
});

test("file over 10 MB throws FILE_TOO_LARGE; empty throws EMPTY; ragged throws MALFORMED", () => {
  const codeOf = (text: string): string => {
    try {
      parseCsv(text);
    } catch (e) {
      return e instanceof CsvError ? e.code : "OTHER";
    }
    return "NONE";
  };
  assert(codeOf("a\n" + "x".repeat(10 * 1024 * 1024)) === "FILE_TOO_LARGE", "too large");
  assert(codeOf("") === "EMPTY", "empty");
  assert(codeOf("a,b\n1\n") === "MALFORMED", "malformed");
});

test("validateDataset converts CsvError to file-level reject", () => {
  const r = run("id,note\np1\n");
  assert(hasReject(r, "MALFORMED") && r.issues[0].row === 0, "MALFORMED file-level");
  assert(r.files["parents.csv"].rowsAccepted === 0, "0 accepted");
  assert(!r.canCommit, "cannot commit");
});

test("warnings-only registry checks keep canCommit true; throwing check -> CHECK_FAILED", () => {
  checks.t_warn = () => [
    { file: "parents.csv", row: 2, severity: "warn", code: "W1", message: "w" },
    { file: "parents.csv", row: 2, severity: "warn", code: "W2", message: "w" },
  ];
  checks.t_throw = () => {
    throw new Error("boom");
  };
  try {
    const d1: DatasetDefinition = { ...def, tables: [{ ...def.tables[0], checks: ["t_warn"] }, def.tables[1]] };
    const r1 = run(P, undefined, d1);
    assert(r1.canCommit && codes(r1).length === 2, "warnings only");
    const d2: DatasetDefinition = { ...def, tables: [{ ...def.tables[0], checks: ["t_throw"] }, def.tables[1]] };
    const r2 = run(P, undefined, d2);
    assert(hasReject(r2, "CHECK_FAILED") && !r2.canCommit, "CHECK_FAILED");
  } finally {
    delete checks.t_warn;
    delete checks.t_throw;
  }
});

test("any reject -> canCommit false; trailing blank lines ignored", () => {
  assert(!run(P, `${CH}\np1,zzz,,,,,,,\n`).canCommit, "reject blocks");
  const r = run("id,note\np1,a\n\n\n", undefined);
  assert(r.canCommit && r.files["parents.csv"].rowsRead === 1, "blank lines ignored");
});

test("row numbers are 1-based file lines across blank and multiline rows", () => {
  const r = run('id,note\np1,"a\nb"\n\np1,c\n');
  const issue = r.issues.find((i) => i.code === "DUPLICATE_KEY");
  assert(issue && issue.row === 5, `expected row 5, got ${issue && issue.row}`);
});

test("mixed-case header accepted", () => {
  const r = run("ID,Note\np1,hi\n");
  assert(r.canCommit && r.rows.parents[0].id === "p1", JSON.stringify(r.issues));
});

test("padded header accepted", () => {
  const r = run(" id , note \np1,hi\n");
  assert(r.canCommit, JSON.stringify(r.issues));
});

test("id,ID is DUPLICATE_HEADER", () => {
  const r = run("id,ID\np1,p1\n");
  assert(hasReject(r, "DUPLICATE_HEADER"), JSON.stringify(r.issues));
});

test("CRLF multiline cell row numbers", () => {
  const r = run('id,note\r\np1,"a\r\nb"\r\n\r\np1,c\r\n');
  const issue = r.issues.find((i) => i.code === "DUPLICATE_KEY");
  assert(issue && issue.row === 5, `expected row 5, got ${issue && issue.row}`);
  assert(r.rows.parents[0].note === "a\nb", "cell content");
});

test("exactly 20,000 rows accepted", () => {
  const text = "id\n" + Array.from({ length: 20000 }, (_, i) => `r${i}`).join("\n");
  assert(parseCsv(text).rows.length === 20000, "20,000 rows parse");
});

test("- and null rejected in integer column", () => {
  for (const tok of ["-", "null"]) {
    assert(hasReject(run(P, `${CH}\np1,a,,${tok},,,,,\n`), "NULL_TOKEN"), tok);
  }
});

test("final review S5: string columns default to maxLength 1000; text stays 4000", () => {
  assert(!hasReject(run(`id,note\n${"s".repeat(1000)},x\n`), "TOO_LONG"), "1000-char string accepted");
  assert(hasReject(run(`id,note\n${"s".repeat(1001)},x\n`), "TOO_LONG"), "1001-char string rejected");
  assert(!hasReject(run(`id,note\np1,${"t".repeat(4000)}\n`), "TOO_LONG"), "4000-char text accepted");
  assert(hasReject(run(`id,note\np1,${"t".repeat(4001)}\n`), "TOO_LONG"), "4001-char text rejected");
  const wide: DatasetDefinition = { ...def, tables: [{ ...def.tables[0], columns: [{ name: "id", type: "string", required: true, maxLength: 5000 }, { name: "note", type: "text" }] }] };
  assert(!hasReject(run(`id,note\n${"s".repeat(4500)},x\n`, undefined, wide), "TOO_LONG"), "explicit maxLength wins");
});

let failed = 0;
for (const c of cases) {
  try {
    c.run();
    console.log(`ok - ${c.name}`);
  } catch (e) {
    failed += 1;
    console.error(`not ok - ${c.name}: ${(e as Error).message}`);
  }
}
if (failed > 0) throw new Error(`${failed} dataset validator case(s) failed`);
