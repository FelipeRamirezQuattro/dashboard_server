import { getSourceLine } from "./datasetValidator";
import { DatasetDefinition, RowIssue } from "./types";

export type CheckFn = (rows: Record<string, Record<string, unknown>[]>, def: DatasetDefinition) => RowIssue[];

type Rows = Record<string, Record<string, unknown>[]>;

const DAY_MS = 86_400_000;
const dayNumber = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

// Real source line from the validator; falls back to index-based (header = line 1) if unknown.
const lineOf = (row: Record<string, unknown>, index: number): number => getSourceLine(row) ?? index + 2;

const daysRunConsistency: CheckFn = (rows) => {
  const issues: RowIssue[] = [];
  (rows.cases ?? []).forEach((r, i) => {
    if (typeof r.install_date !== "string" || typeof r.pull_date !== "string" || typeof r.days_run !== "number") return;
    const diff = dayNumber(r.pull_date) - dayNumber(r.install_date);
    if (Math.abs(diff - r.days_run) > 2) {
      issues.push({
        file: "cases.csv",
        row: lineOf(r, i),
        column: "days_run",
        severity: "warn",
        code: "days_run_consistency",
        message: `case ${String(r.case_id)}: days_run differs from pull_date minus install_date by more than 2 days`,
      });
    }
  });
  return issues;
};

const solidsSum: CheckFn = (rows) => {
  const totals = new Map<string, number>();
  for (const r of rows.solids ?? []) {
    if (typeof r.percent === "number") totals.set(String(r.case_id), (totals.get(String(r.case_id)) ?? 0) + r.percent);
  }
  const issues: RowIssue[] = [];
  (rows.cases ?? []).forEach((r, i) => {
    const total = totals.get(String(r.case_id));
    if (total === undefined || (total >= 98 && total <= 102)) return;
    issues.push({
      file: "cases.csv",
      row: lineOf(r, i),
      column: "percent",
      severity: "warn",
      code: "solids_sum",
      message: `case ${String(r.case_id)}: solids percentages sum to ${total}, outside 98-102`,
    });
  });
  return issues;
};

const tubingFailureMechanism: CheckFn = (rows) => {
  const issues: RowIssue[] = [];
  (rows.cases ?? []).forEach((r, i) => {
    const mech = r.primary_failure_mechanism;
    if (r.reason_for_pulling === "tubing_failure" && Array.isArray(mech) && mech.length > 0) {
      issues.push({
        file: "cases.csv",
        row: lineOf(r, i),
        column: "primary_failure_mechanism",
        severity: "warn",
        code: "tubing_failure_mechanism",
        message: `case ${String(r.case_id)}: tubing failure is not a pump-failure mechanism but primary_failure_mechanism is set`,
      });
    }
  });
  return issues;
};

const caseHasChildren: CheckFn = (rows: Rows) => {
  const children: { table: string; file: string }[] = [
    { table: "components", file: "components.csv" },
    { table: "wear", file: "wear.csv" },
    { table: "solids", file: "solids.csv" },
  ];
  const issues: RowIssue[] = [];
  (rows.cases ?? []).forEach((r, i) => {
    for (const child of children) {
      const has = (rows[child.table] ?? []).some((c) => c.case_id === r.case_id);
      if (has) continue;
      issues.push({
        file: "cases.csv",
        row: lineOf(r, i),
        column: "case_id",
        severity: "warn",
        code: "case_has_children",
        message: `case ${String(r.case_id)} has no rows in ${child.file}`,
      });
    }
  });
  return issues;
};

/** Named cross-row checks, referenced by id from `TableDef.checks`. */
export const checks: Record<string, CheckFn> = {
  days_run_consistency: daysRunConsistency,
  solids_sum: solidsSum,
  tubing_failure_mechanism: tubingFailureMechanism,
  case_has_children: caseHasChildren,
};
