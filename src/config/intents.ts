import { Intent } from "../types/chatbot.types";

export const intents: Intent[] = [
  // Chemical Tracker queries - route directly without AI
  {
    patterns: [
      /chem\s*-?\s*track/i,
      /chemical\s*track/i,
      /chem\s*tracker/i,
      /chemical\s*tracker/i,
      /(wells?|clients?|chemicals?|analytics).*\b(in|from|at|on)\b.*(chem|chemical)\s*-?\s*track/i,
      /(chem|chemical)\s*-?\s*track.*(wells?|clients?|chemicals?|analytics)/i,
      /\b(show|list|get|find|display)\b.*(wells?|clients?|chemicals?).*(chem|chemical)\s*-?\s*track/i,
      /\b(show|list|get|find|display)\b.*(chem|chemical)\s*-?\s*track/i,
    ],
    keywords: ["chemical", "tracker", "chem", "track", "wells", "clients"],
    response: "ROUTE:Chemical Tracker",
  },
  // Designer queries - route directly without AI
  {
    patterns: [
      /\bdesigner\b/i,
      /\b(proposal|proposals)\b.*\b(for|from)\b/i,
      /\bsales\s*order\b.*\b(for|from)\b/i,
      /\btechnical\s*proposal/i,
      /\bwell\s*design/i,
      /\bwellbore/i,
      /\btally\b.*\b(design|report|for)\b/i,
      /\bpulling\s*design/i,
      /\bengineering\s*calc/i,
      /\bproduct\s*config/i,
      /\b(work|jobs?|projects?)\b.*\b(done|completed|performed)\b.*\bfor\b/i,
      /\bwhat\b.*\b(work|jobs?|projects?)\b.*\bfor\b/i,
      /\b(show|list|get|find|pull)\b.*\b(proposal|proposals|sales\s*order)\b/i,
      /\blatest\s*(proposal|sales\s*order)/i,
      /\b(client|customer)\b.*\b(proposal|order|work)/i,
      /\bsimulation\b.*\b(gas|sand|chemical)/i,
      /\b(gas|sand|chemical)\b.*\bsimulation/i,
    ],
    keywords: [
      "designer",
      "proposal",
      "sales",
      "order",
      "well",
      "design",
      "tally",
      "engineering",
    ],
    response: "ROUTE:Designer",
  },
  {
    patterns: [
      /what does osi (separator )?inc\.? do/i,
      /what is osi (separator )?inc/i,
      /tell me about osi/i,
      /osi company/i,
    ],
    keywords: ["what", "osi", "do", "company", "about"],
    response:
      "Odessa Separator Inc. provides oilfield solutions including Filtration / Sand Control, Gas Separation, and Chemical Treatment downhole to help enhance production and operational efficiency.",
  },
  {
    patterns: [
      /what services does osi offer/i,
      /osi services/i,
      /what does osi provide/i,
      /osi offerings/i,
      /osi solutions/i,
    ],
    keywords: ["services", "offer", "provide", "solutions", "offerings"],
    response:
      "OSI offers three main solution areas:\n• Filtration and Sand Control\n• Gas Separation technologies\n• Chemical Treatment systems for downhole environments.",
  },
  {
    patterns: [
      /what industries does osi support/i,
      /osi industries/i,
      /who does osi serve/i,
      /osi customers/i,
      /osi market/i,
    ],
    keywords: ["industries", "support", "serve", "customers", "market"],
    response:
      "OSI primarily supports the Oil & Gas industry by providing solutions that optimize production and address operational challenges such as gas interference, sand production, and chemical treatment.",
  },
  {
    patterns: [
      /what are osi business units/i,
      /osi business units/i,
      /business units/i,
      /list business units/i,
      /tell me about business units/i,
    ],
    keywords: ["business", "units", "divisions"],
    response:
      "The OSI platform organizes operations into multiple Business Units such as:\n• OSI Rod Pump Division\n• Odessa Separator Inc\n• Petro\n\nEach business unit contains multiple departments like Sales, Technical, and Manufacturing.",
  },
  {
    patterns: [
      /what departments exist in osi/i,
      /osi departments/i,
      /list departments/i,
      /departments in osi/i,
      /tell me about departments/i,
    ],
    keywords: ["departments", "teams"],
    response:
      "Departments within OSI typically include:\n• Sales\n• Technical\n• Manufacturing\n• Engineering\n• Quality\n• Operations\n• HSE (Health, Safety & Environment)",
  },
  {
    patterns: [
      /what is the vision of osi/i,
      /osi vision/i,
      /vision statement/i,
      /company vision/i,
    ],
    keywords: ["vision", "future", "goal"],
    response:
      "OSI's vision is to become one of the market leaders in providing innovative solutions and technologies in areas such as filtration, sand control, gas separation, and chemical treatment for the oilfield.",
  },
  {
    patterns: [
      /what is the mission of osi/i,
      /osi mission/i,
      /mission statement/i,
      /company mission/i,
    ],
    keywords: ["mission", "purpose", "dedication"],
    response:
      "OSI is dedicated to satisfying customer needs through safe processes, environmental protection, operational excellence, and maintaining quality and integrity across all departments.",
  },
  {
    patterns: [
      /\bhello\b/i,
      /\bhi\b/i,
      /\bhey\b/i,
      /good morning/i,
      /good afternoon/i,
      /good evening/i,
    ],
    keywords: ["hello", "hi", "hey", "greetings"],
    response:
      "Hello! I'm the OSI Assistant. I can help you learn about Odessa Separator Inc., our business units, departments, services, and more. How can I assist you today?",
  },
  {
    patterns: [/help/i, /what can you do/i, /how can you help/i, /assist me/i],
    keywords: ["help", "assist", "support"],
    response:
      "I can help you with information about:\n• OSI company overview\n• Services and solutions\n• Business units and departments\n• Company vision and mission\n• Industries we support\n\nJust ask me a question!",
  },
  {
    patterns: [/thank you/i, /thanks/i, /appreciate it/i],
    keywords: ["thank", "thanks", "appreciate"],
    response:
      "You're welcome! If you have any other questions about OSI, feel free to ask.",
  },
  // ==================== EXTERNAL APP QUERIES ====================
  // Chemical Tracker - Wells
  {
    patterns: [
      /show.*wells.*chemical tracker/i,
      /list.*wells.*chemical tracker/i,
      /how many wells.*chemical tracker/i,
      /wells.*in chemical tracker/i,
      /chemical tracker.*wells/i,
      /all wells.*chemical/i,
    ],
    keywords: ["wells", "chemical", "tracker", "show", "list", "how", "many"],
    response: "EXTERNAL_QUERY:chemical_tracker_wells",
  },
  // Chemical Tracker - Analytics/Summary
  {
    patterns: [
      /chemical tracker.*summary/i,
      /chemical tracker.*statistics/i,
      /chemical tracker.*analytics/i,
      /how many.*chemical tracker/i,
      /stats.*chemical tracker/i,
      /overview.*chemical tracker/i,
    ],
    keywords: [
      "chemical",
      "tracker",
      "summary",
      "statistics",
      "analytics",
      "stats",
      "overview",
    ],
    response: "EXTERNAL_QUERY:chemical_tracker_analytics",
  },
  // Chemical Tracker - Clients
  {
    patterns: [
      /show.*clients.*chemical tracker/i,
      /list.*clients.*chemical tracker/i,
      /chemical tracker.*clients/i,
      /clients.*in chemical tracker/i,
      /all clients.*chemical/i,
    ],
    keywords: ["clients", "chemical", "tracker", "show", "list", "all"],
    response: "EXTERNAL_QUERY:chemical_tracker_clients",
  },
];

export const fallbackResponse =
  "This capability will be implemented in a future AI-powered version of the OSI Assistant.";
