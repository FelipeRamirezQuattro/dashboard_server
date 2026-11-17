import { DatasetDefinition, TableDef } from "./types";

type Row = Record<string, unknown>;

export interface RecordCard {
  primaryKeyValue: string;
  text: string;
  rowEvidence: { id: string; table: string; text: string }[];
}

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

const render = (v: unknown): string => {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(",");
  // Keep each row on one line: fold any line breaks inside a value into single spaces.
  return String(v).replace(/\s*[\r\n]+\s*/g, " ").trim();
};

const rowLine = (table: TableDef, row: Row): string => {
  const pairs: string[] = [];
  for (const col of table.columns) {
    const v = row[col.name];
    if (!isEmpty(v)) pairs.push(`${col.name}=${render(v)}`);
  }
  return `${table.name}: ${pairs.join("; ")}`;
};

const keyParts = (table: TableDef, row: Row): string[] => table.primaryKey.map((k) => render(row[k]));
const keyValue = (table: TableDef, row: Row): string => keyParts(table, row).join("|");

const compareKey = (table: TableDef, a: Row, b: Row): number => {
  for (const k of table.primaryKey) {
    const x = a[k];
    const y = b[k];
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x < y ? -1 : 1;
      continue;
    }
    const sx = render(x);
    const sy = render(y);
    if (sx !== sy) return sx < sy ? -1 : 1;
  }
  return 0;
};

export const buildRecordCards = (def: DatasetDefinition, rows: Record<string, Row[]>): RecordCard[] => {
  if (!def.card) return [];
  const byName = new Map(def.tables.map((t) => [t.name, t]));
  const root = byName.get(def.card.rootTable);
  if (!root) return [];
  const evidenceId = (t: TableDef, row: Row): string => `ds:${def.key}/${t.name}/${keyValue(t, row)}`;

  const children = def.card.include
    .map((name) => byName.get(name))
    .filter((t): t is TableDef => !!t)
    .map((table) => ({ table, ref: table.references.find((r) => r.table === root.name) }))
    .filter((c): c is { table: TableDef; ref: NonNullable<typeof c.ref> } => !!c.ref);

  return [...(rows[root.name] ?? [])]
    .sort((a, b) => compareKey(root, a, b))
    .map((rootRow) => {
      const evidence = [{ id: evidenceId(root, rootRow), table: root.name, text: rowLine(root, rootRow) }];
      for (const { table, ref } of children) {
        const target = render(rootRow[ref.refColumn]);
        const matching = (rows[table.name] ?? [])
          .filter((r) => !isEmpty(r[ref.column]) && render(r[ref.column]) === target)
          .sort((a, b) => compareKey(table, a, b));
        for (const r of matching) evidence.push({ id: evidenceId(table, r), table: table.name, text: rowLine(table, r) });
      }
      return {
        primaryKeyValue: keyValue(root, rootRow),
        text: evidence.map((e) => e.text).join("\n"),
        rowEvidence: evidence,
      };
    });
};
