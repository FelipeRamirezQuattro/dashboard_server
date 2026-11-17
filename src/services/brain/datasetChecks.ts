import { DatasetDefinition, RowIssue } from "./types";

export type CheckFn = (rows: Record<string, Record<string, unknown>[]>, def: DatasetDefinition) => RowIssue[];

/** Named cross-row checks, referenced by id from `TableDef.checks`. Filled in by dataset definitions. */
export const checks: Record<string, CheckFn> = {};
