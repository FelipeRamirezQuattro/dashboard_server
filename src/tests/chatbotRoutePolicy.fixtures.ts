import { decideChatRoute } from "../services/chatbotRoutePolicy.service";

const assertEqual = <T>(actual: T, expected: T, message: string): void => {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}`);
  }
};

const assertNotEqual = <T>(actual: T, expected: T, message: string): void => {
  if (actual === expected) {
    throw new Error(`${message}. Did not expect ${String(expected)}`);
  }
};

const fixtures = [
  {
    message: "give me SO1042",
    route: "internal_ai_assistant",
    bypassN8n: true,
  },
  {
    message: "what was our last sales order",
    route: "internal_ai_assistant",
    bypassN8n: true,
  },
  {
    message: "show me proposals in Designer",
    route: "designer",
    bypassN8n: false,
  },
  {
    message: "how are things going today?",
    route: "clarify",
    bypassN8n: false,
  },
  {
    message: "Why did ACS-1228 fail?",
    route: "rod_pump_failure",
    bypassN8n: false,
  },
  {
    message: "What is the best pump used in Middle Spraberry?",
    route: "rod_pump_failure",
    bypassN8n: false,
  },
  {
    message: "What is the best pump utilized in Middle Spraberry? Diameter, Barrel Material, Plunger type, Plunger fit, Max run life",
    route: "rod_pump_failure",
    bypassN8n: false,
  },
  {
    message: "How many days did AS-1508 run?",
    route: "rod_pump_failure",
    bypassN8n: false,
  },
  {
    message: "show me pump tracker",
    route: "pump_tracker",
    bypassN8n: false,
  },
  {
    message: "list as 100 wells",
    route: "clarify",
    bypassN8n: false,
  },
] as const;

for (const fixture of fixtures) {
  const decision = decideChatRoute(fixture.message);
  assertEqual(
    decision.route,
    fixture.route,
    `${fixture.message} should route to ${fixture.route}`,
  );
  assertEqual(
    decision.bypassN8n,
    fixture.bypassN8n,
    `${fixture.message} bypassN8n mismatch`,
  );
}

const documentSearchCandidate = decideChatRoute("find proposal PDF");
assertNotEqual(
  documentSearchCandidate.route,
  "internal_ai_assistant",
  "find proposal PDF should stay available for document search before deterministic app routing",
);
