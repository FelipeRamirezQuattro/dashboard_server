import { ColumnDef, DatasetDefinition, TableDef } from "../types";

// Controlled vocabularies (contract B7, taxonomy v0). Owned by the Rod Pump engineering
// lead: edit the lists below; the definition references them. Values outside a list are rejected.
export const COMPONENT_TYPES = [
  "barrel", "plunger", "standing_valve_ball", "standing_valve_seat", "standing_valve_cage",
  "traveling_valve_ball", "traveling_valve_seat", "traveling_valve_cage", "valve_rod",
  "valve_rod_bushing", "valve_rod_guide", "top_plunger_adapter", "top_extension",
  "bottom_extension", "barrel_bushing", "hold_down", "seating_cups", "spacer_rings",
  "lock_nut", "strainer_bushing", "coupling", "collet_nut", "seat_plug", "other",
];

export const PART_CONDITIONS = [
  "new", "good", "worn", "galled", "scored", "pitted", "corroded", "leaked", "sand_cut",
  "pounded", "tool_marked", "stuck", "missing", "beyond_run_life", "replaced", "other",
];

/** Failure-mode codes for `observed_modes` and `primary_failure_mechanism`. */
export const FAILURE_MODES = [
  "wear", "galling", "scoring", "pitting", "corrosion", "seal_loss_vacuum_fail", "sand_cut",
  "tagging", "paraffin_deposit", "scale_caco3", "scale_fes", "beyond_run_life",
  "mechanical_damage", "other",
];

// Other enums (contract B1-B6).
export const REASONS_FOR_PULLING = [
  "pump_failure", "tubing_failure", "rod_failure", "planned", "production_drop", "other",
];
export const API_CLASSES = ["A", "B", "C"];
export const VALVE_TESTS = ["holds", "leaks", "not_tested"];
export const WEAR_LOCATIONS = ["barrel_in", "barrel_out", "plunger_in", "plunger_out"];
export const WEAR_UNITS = ["mil", "in"];
export const SOLID_SPECIES = [
  "water_soluble", "hydrocarbon_paraffin", "scale_caco3", "scale_fes", "iron_species",
  "acid_insoluble_sand", "other",
];
export const ACTION_TYPES = [
  "material_change", "fit_change", "component_replacement", "run_life_limit",
  "operating_change", "chemical_treatment", "other",
];
export const APPLIED_IN_NEXT_RUN = ["yes", "no", "unknown"];
export const EVIDENCE_KINDS = ["report_pdf", "photo", "table", "note"];

const req = (c: ColumnDef): ColumnDef => ({ required: true, ...c });
const caseRef = { column: "case_id", table: "cases", refColumn: "case_id" };

const cases: TableDef = {
  name: "cases",
  file: "cases.csv",
  required: true,
  primaryKey: ["case_id"],
  columns: [
    req({ name: "case_id", type: "string", maxLength: 60 }),
    req({ name: "pump_serial", type: "string", maxLength: 60 }),
    req({ name: "pump_model", type: "string", maxLength: 60 }),
    req({ name: "pull_date", type: "date", notFuture: true }),
    req({ name: "days_run", type: "integer", min: 0 }),
    { name: "install_date", type: "date" },
    req({ name: "reason_for_pulling", type: "enum", values: REASONS_FOR_PULLING }),
    { name: "failure_cause_label", type: "string", maxLength: 120 },
    { name: "primary_failure_mechanism", type: "enum_list", values: FAILURE_MODES },
    { name: "max_stroke_in", type: "number", min: 0.000001 },
    { name: "valve_rod_size_in", type: "number", min: 0.000001 },
    { name: "formation", type: "string", maxLength: 80 },
    { name: "pump_bore_in", type: "number", min: 0.000001 },
    { name: "barrel_material", type: "string", maxLength: 80 },
    { name: "plunger_type", type: "string", maxLength: 80 },
    { name: "plunger_fit", type: "string", maxLength: 40 },
    { name: "inspection_summary", type: "text" },
    { name: "remarks", type: "text" },
    { name: "client_label", type: "string", maxLength: 80 },
  ],
  references: [],
  checks: ["days_run_consistency", "tubing_failure_mechanism", "case_has_children"],
};

const components: TableDef = {
  name: "components",
  file: "components.csv",
  required: false,
  primaryKey: ["component_id"],
  columns: [
    req({ name: "case_id", type: "string" }),
    req({ name: "component_id", type: "string", maxLength: 60 }),
    req({ name: "component_type", type: "enum", values: COMPONENT_TYPES }),
    req({ name: "part_condition", type: "enum", values: PART_CONDITIONS }),
    { name: "api_class", type: "enum", values: API_CLASSES },
    { name: "observed_modes", type: "enum_list", values: FAILURE_MODES },
    { name: "valve_test", type: "enum", values: VALVE_TESTS },
    { name: "is_primary_failure", type: "boolean" },
    { name: "part_number", type: "string", maxLength: 60 },
    { name: "material", type: "string", maxLength: 60 },
    { name: "quantity", type: "integer", min: 0 },
    { name: "replaced_by_part_number", type: "string", maxLength: 60 },
    { name: "comment", type: "text" },
  ],
  references: [caseRef],
  checks: [],
};

const wear: TableDef = {
  name: "wear",
  file: "wear.csv",
  required: false,
  primaryKey: ["case_id", "location", "position_ft"],
  columns: [
    req({ name: "case_id", type: "string" }),
    req({ name: "location", type: "enum", values: WEAR_LOCATIONS }),
    req({ name: "position_ft", type: "integer", min: 0 }),
    req({ name: "value", type: "number", min: 0 }),
    req({ name: "unit", type: "enum", values: WEAR_UNITS }),
  ],
  references: [caseRef],
  checks: [],
};

const solids: TableDef = {
  name: "solids",
  file: "solids.csv",
  required: false,
  primaryKey: ["case_id", "species"],
  columns: [
    req({ name: "case_id", type: "string" }),
    req({ name: "species", type: "enum", values: SOLID_SPECIES }),
    req({ name: "percent", type: "percent" }),
    { name: "appearance", type: "string", maxLength: 120 },
    { name: "method", type: "string", maxLength: 120 },
  ],
  references: [caseRef],
  checks: ["solids_sum"],
};

const actions: TableDef = {
  name: "actions",
  file: "actions.csv",
  required: false,
  primaryKey: ["action_id"],
  columns: [
    req({ name: "action_id", type: "string", maxLength: 60 }),
    req({ name: "case_id", type: "string" }),
    req({ name: "action_type", type: "enum", values: ACTION_TYPES }),
    req({ name: "description", type: "text" }),
    req({ name: "applied_in_next_run", type: "enum", values: APPLIED_IN_NEXT_RUN }),
    { name: "next_case_id", type: "string" },
    { name: "outcome_note", type: "text" },
  ],
  references: [caseRef, { column: "next_case_id", table: "cases", refColumn: "case_id" }],
  checks: [],
};

const evidence: TableDef = {
  name: "evidence",
  file: "evidence.csv",
  required: false,
  primaryKey: ["evidence_id"],
  columns: [
    req({ name: "evidence_id", type: "string", maxLength: 60 }),
    req({ name: "case_id", type: "string" }),
    req({ name: "kind", type: "enum", values: EVIDENCE_KINDS }),
    req({ name: "file_name", type: "string", maxLength: 200 }),
    { name: "page", type: "integer", min: 1 },
    { name: "caption", type: "string", maxLength: 200 },
  ],
  references: [caseRef],
  checks: [],
};

export const rodPumpFailureDefinition: DatasetDefinition = {
  key: "rod_pump_failure",
  version: "0.2",
  label: "Rod Pump Failure",
  tables: [cases, components, wear, solids, actions, evidence],
  card: { rootTable: "cases", include: ["components", "wear", "solids", "actions"] },
};
