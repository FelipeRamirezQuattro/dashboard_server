export type RouteTarget =
  | "file_bank"
  | "onedrive"
  | "chemical_tracker"
  | "designer"
  | "internal_ai_assistant"
  | "pump_tracker"
  | "rod_pump_failure"
  | "workflow_brain"
  | "general"
  | "clarify";

export interface RoutePolicyDecision {
  route: RouteTarget;
  query: string;
  confidence: number;
  matchedRule: string;
  bypassN8n: boolean;
  reason: string;
  category?: string;
}

const INTERNAL_AI_HIGH_CONFIDENCE_RULES = [
  {
    name: "explicit_so_number",
    pattern: /\bso\s*#?\s*\d{3,}\b/,
    reason: "Explicit sales-order number.",
  },
  {
    name: "sales_order_number",
    pattern: /\bsales\s*orders?\b.*\b\d{3,}\b|\b\d{3,}\b.*\bsales\s*orders?\b/,
    reason: "Sales-order phrase with a concrete number.",
  },
  {
    name: "sales_order_lookup",
    pattern:
      /\b(last|latest|recent|count|total|status|detail|details|lookup|find|show|get|fetch)\b.*\bsales\s*orders?\b|\bsales\s*orders?\b.*\b(last|latest|recent|count|total|status|detail|details|lookup|find|show|get|fetch)\b/,
    reason: "Sales-order lookup intent.",
  },
  {
    name: "proposal_authoring",
    pattern: /\b(proposal|proposals)\b.*\b(draft|write|create|generate|edit|revise)\b/,
    reason: "Technical proposal authoring intent.",
  },
  {
    name: "official_pdf",
    pattern: /\bofficial\s+pdf\b/,
    reason: "Official PDF request.",
  },
  {
    name: "erp",
    pattern: /\berp\b/,
    reason: "Explicit ERP request.",
  },
];

// Rod Pump Failure Intelligence. Evaluated BEFORE chemical/designer/pump_tracker
// so failure-analysis questions are not swallowed by the broad `pump`/`design`
// regexes. Case ids are matched case-sensitively on the ORIGINAL message
// (e.g. "DBO-31", "ACS-1228") to avoid matching the word "as".
const ROD_PUMP_CASE_ID = /\b(?:DBO|ACS|CMS|AS|TOM)-\d{1,5}\b/;
const ROD_PUMP_FAILURE_RULES = [
  {
    name: "rod_pump_failure_analysis",
    pattern:
      /\b(rod\s*pump|pump)\s+failures?\b|\bfailure[-\s]+(analysis|analyses|intelligence|pattern|patterns|mode|modes|cause|causes|driven)\b|\bfailure\s+meeting\b/,
    reason: "Rod pump failure analysis terms.",
  },
  {
    name: "rod_pump_run_life",
    pattern: /\brun\s*-?\s*life\b|\bdays\s+run\b/,
    reason: "Pump run-life question.",
  },
  {
    name: "rod_pump_similar_failures",
    pattern: /\bsimilar\s+(failures?|cases?)\b/,
    reason: "Similar failure case lookup.",
  },
  {
    name: "rod_pump_wear_evidence",
    pattern:
      /\b(galling|galled|scoring|scored|pitting|paraffin|scale)\b.*\b(pump|plunger|barrel|valve|rod)\b|\b(pump|plunger|barrel|valve|rod)\b.*\b(galling|galled|scoring|scored|pitting|paraffin|scale)\b/,
    reason: "Rod pump wear/deposit evidence terms.",
  },
  {
    name: "rod_pump_recommendation",
    pattern:
      /\brecommend\w*\b.*\b(pump|plunger|barrel|valve)\b|\b(pump|plunger|barrel|valve)\b.*\brecommend\w*\b/,
    reason: "Rod pump design/operating recommendation request.",
  },
];

const matchRodPumpFailure = (
  message: string,
  msg: string,
): { name: string; reason: string } | undefined => {
  if (ROD_PUMP_CASE_ID.test(message)) {
    return {
      name: "rod_pump_case_id",
      reason: "Rod pump failure case identifier.",
    };
  }
  return ROD_PUMP_FAILURE_RULES.find((rule) => rule.pattern.test(msg));
};

export const detectWorkflowBrainCategory = (
  message: string,
): string | undefined => {
  if (/\b(gas|separator|separation)\b/.test(message)) return "Gas Separation";
  if (/\b(chemical|treatment)\b/.test(message)) return "Chemical Treatment";
  if (/\b(sand|filtration|filter)\b/.test(message)) {
    return "Sand / Filtration Control";
  }
  if (/\b(sales|handoff)\b/.test(message)) return "Sales Engineering";
  if (/\b(qa|qc|quality|inspection)\b/.test(message)) return "QA/QC";
  if (/\b(proposal|proposals)\b/.test(message)) return "Proposals";
  if (/\b(field service|service)\b/.test(message)) return "Field Service";
  if (/\b(manufacturing|shop|fabrication)\b/.test(message)) {
    return "Manufacturing";
  }
  return undefined;
};

export const decideChatRoute = (message: string): RoutePolicyDecision => {
  const msg = message.toLowerCase();

  for (const rule of INTERNAL_AI_HIGH_CONFIDENCE_RULES) {
    if (rule.pattern.test(msg)) {
      return {
        route: "internal_ai_assistant",
        query: message,
        confidence: rule.name === "proposal_authoring" ? 0.88 : 0.95,
        matchedRule: rule.name,
        bypassN8n: true,
        reason: rule.reason,
      };
    }
  }

  const rodPumpMatch = matchRodPumpFailure(message, msg);
  if (rodPumpMatch) {
    return {
      route: "rod_pump_failure",
      query: message,
      confidence: 0.9,
      matchedRule: rodPumpMatch.name,
      bypassN8n: false,
      reason: rodPumpMatch.reason,
    };
  }

  if (
    /\b(chem|chemical)\s*-?\s*tracker\b/.test(msg) ||
    /\b(wells?|clients?|chemicals?|analytics)\b.*\b(chem|chemical)\b/.test(msg)
  ) {
    return {
      route: "chemical_tracker",
      query: message,
      confidence: 0.95,
      matchedRule: "chemical_tracker",
      bypassN8n: false,
      reason: "Chemical Tracker domain terms.",
    };
  }

  if (
    /\bdesigner\b/.test(msg) ||
    /\b(proposals?|sales\s*orders?|wellbore|tally|designs?|simulation)\b/.test(msg)
  ) {
    return {
      route: "designer",
      query: message,
      confidence: 0.9,
      matchedRule: "designer",
      bypassN8n: false,
      reason: "Designer app domain terms.",
    };
  }

  if (/\b(pump\s*-?\s*tracker|pump\s+pro|rod\s*pump|pump\s+performance|pumps?)\b/.test(msg)) {
    return {
      route: "pump_tracker",
      query: message,
      confidence: 0.9,
      matchedRule: "pump_tracker",
      bypassN8n: false,
      reason: "Pump Tracker domain terms.",
    };
  }

  if (
    /\b(workflow\s+brain|process\s+brain|design\s+brain|category\s+memory|workflow\s+category|osi\s+process|separator\s+workflow|design\s+checklist)\b/.test(msg) ||
    /\b(workflow|process|handoff|checklist|unknown\s+areas?)\b.*\b(separator|design|engineering|qa|qc|proposal|sales)\b/.test(msg)
  ) {
    return {
      route: "workflow_brain",
      query: message,
      confidence: 0.9,
      matchedRule: "workflow_brain",
      bypassN8n: false,
      reason: "Workflow Brain domain terms.",
      category: detectWorkflowBrainCategory(msg),
    };
  }

  return {
    route: "clarify",
    query: message,
    confidence: 0,
    matchedRule: "none",
    bypassN8n: false,
    reason: "No deterministic route matched.",
  };
};
