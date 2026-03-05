import { Intent } from "../types/chatbot.types";

export const intents: Intent[] = [
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
      /hello/i,
      /hi/i,
      /hey/i,
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
];

export const fallbackResponse =
  "This capability will be implemented in a future AI-powered version of the OSI Assistant.";
