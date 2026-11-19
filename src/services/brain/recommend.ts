import type { Evidence, Statement } from "./types";

/**
 * Deterministic "best pump in a formation" answer. No model is involved: the winner is the stored case with the
 * highest days_run among the retrieved `cases` rows whose formation is named in the question, and every attribute is
 * copied verbatim from that row. Statements go through the normal citation + number gate and composeAnswer, so the
 * reply format is the same as any other grounded answer. Returns null when the question is not of this shape or no
 * stored formation is named (the caller then uses the model path / insufficient reply).
 */

const TRIGGER_BEST = /\b(best|top|longest|highest|greatest)\b/;
const TRIGGER_PUMP = /\b(pumps?|run life|runlife)\b/;
const MAX_WINNERS = 3;

const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/** Parses a `cases: col=v; col=v` evidence row into a column map. */
export const parseCaseRow = (text: string): Record<string, string> | null => {
  if (!text.startsWith("cases: ")) return null;
  const body = text.slice("cases: ".length);
  const parts = body.split(/; (?=[a-z_][a-z0-9_]*=)/);
  const out: Record<string, string> = {};
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1).trim();
  }
  return out.case_id ? out : null;
};

interface CaseRow {
  id: string;
  fields: Record<string, string>;
  days: number;
}

const caseRows = (evidence: Evidence[]): CaseRow[] => {
  const rows: CaseRow[] = [];
  for (const e of evidence) {
    if (e.kind !== "row" || e.isGuidance) continue;
    const fields = parseCaseRow(e.text);
    if (!fields) continue;
    const days = Number(fields.days_run);
    if (!Number.isFinite(days)) continue;
    rows.push({ id: e.id, fields, days });
  }
  return rows;
};

const attr = (fields: Record<string, string>, key: string, suffix = ""): string =>
  fields[key] ? `${fields[key]}${suffix}` : "not recorded";

export const buildBestPumpStatements = (question: string, evidence: Evidence[]): Statement[] | null => {
  const q = norm(question);
  if (!TRIGGER_BEST.test(q) || !TRIGGER_PUMP.test(q)) return null;

  const all = caseRows(evidence);
  if (!all.length) return null;
  const formations = [...new Set(all.map((r) => r.fields.formation).filter((f): f is string => Boolean(f)))];
  const named = formations.filter((f) => norm(f) && ` ${q} `.includes(` ${norm(f)} `));
  if (!named.length) return null;
  // "Spraberry" alone names every Spraberry formation; the longest-named match wins when one contains another.
  const formation = named.sort((a, b) => b.length - a.length)[0];

  const inFormation = all.filter((r) => r.fields.formation === formation).sort((a, b) => b.days - a.days);
  if (!inFormation.length) return null;
  const top = inFormation[0].days;
  const winners = inFormation.filter((r) => r.days === top).slice(0, MAX_WINNERS);
  const rest = inFormation.filter((r) => r.days < top);

  const out: Statement[] = [];
  const ids = winners.map((w) => w.fields.case_id).join(", ");
  out.push({
    text: `Recommended pump for ${formation} (draft): ${ids}, the longest stored run life in this formation.`,
    citations: winners.map((w) => w.id),
  });
  for (const w of winners) {
    const label = winners.length > 1 ? `${w.fields.case_id} - ` : "";
    const c = [w.id];
    out.push({ text: `${label}Diameter: ${attr(w.fields, "pump_bore_in", " in")}`, citations: c });
    out.push({ text: `${label}Barrel material: ${attr(w.fields, "barrel_material")}`, citations: c });
    out.push({ text: `${label}Plunger type: ${attr(w.fields, "plunger_type")}`, citations: c });
    out.push({ text: `${label}Plunger fit: ${attr(w.fields, "plunger_fit")}`, citations: c });
    out.push({ text: `${label}Max run life: ${w.days} days`, citations: c });
  }
  if (rest.length) {
    out.push({
      text: `Next longest in ${formation}: ${rest[0].fields.case_id} with ${rest[0].days} days.`,
      citations: [rest[0].id],
    });
  }
  return out;
};
