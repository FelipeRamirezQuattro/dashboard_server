export type ColumnType = "string" | "int" | "number" | "boolean" | "date" | "datetime" | "enum";

export interface ColumnDef {
  name: string;
  type: ColumnType;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  values?: string[];
  notFuture?: boolean;
}

export interface TableDef {
  name: string;
  file: string;
  required: boolean;
  primaryKey: string[];
  columns: ColumnDef[];
  references: { column: string; table: string; refColumn: string }[];
  checks: string[];
}

export interface DatasetDefinition {
  key: string;
  version: string;
  label: string;
  tables: TableDef[];
  card?: { rootTable: string; include: string[] };
}

export interface RowIssue {
  file: string;
  row: number;
  column?: string;
  severity: "reject" | "warn";
  code: string;
  message: string;
}

export interface ImportReport {
  datasetKey: string;
  datasetVersion: string;
  files: Record<string, { rowsRead: number; rowsAccepted: number; rowsRejected: number }>;
  issues: RowIssue[];
  canCommit: boolean;
  rows: Record<string, Record<string, unknown>[]>;
}

export interface Evidence {
  id: string;
  kind: "chunk" | "row";
  text: string;
  label: string;
  fileName?: string;
  page?: number;
  score: number;
  isGuidance: boolean;
}

export interface Statement {
  text: string;
  citations: string[];
}

export interface Citation {
  id: string;
  label: string;
  fileName?: string;
  page?: number;
}
