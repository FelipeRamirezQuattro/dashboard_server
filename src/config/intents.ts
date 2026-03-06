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
  {
    patterns: [
      /so29311/i,
      /pull.*so29311/i,
      /show.*so29311/i,
      /sales order 29311/i,
      /order 29311/i,
    ],
    keywords: ["so29311", "order", "29311", "pull"],
    response:
      "I found Sales Order SO29311! 📄\n\n🔗 [Download SO29311.pdf](/documents/SO29311.pdf)\n\nHere are the details:\n🏢 **Customer**: OXYROCK\n🛢️ **Well**: YAMAHA PACIFICA 10HA\n📅 **Date**: Available in document\n📦 **Items**: See attached PDF for complete details\n\nClick the link above to download the full sales order document!",
  },
  {
    patterns: [
      /pull.*sales order.*oxyrock/i,
      /last.*sales order.*oxyrock/i,
      /oxyrock.*sales order/i,
      /yamaha pacifica 10ha/i,
      /oxyrock.*yamaha pacifica/i,
      /sales order.*yamaha pacifica/i,
      /pull.*last.*sales orders.*from.*oxyrock/i,
      /pull.*last.*sales orders.*oxyrock.*well/i,
    ],
    keywords: [
      "oxyrock",
      "sales",
      "order",
      "orders",
      "yamaha",
      "pacifica",
      "10ha",
      "pull",
      "last",
      "from",
      "well",
    ],
    response:
      "I found the last Sales Order for OXYROCK, well YAMAHA PACIFICA 10HA! 📄\n\n🔗 [Download SO29311.pdf](/documents/SO29311.pdf)\n\nHere are the details:\n📄 **Document**: SO29311\n🏢 **Customer**: OXYROCK\n🛢️ **Well**: YAMAHA PACIFICA 10HA\n📅 **Date**: Available in document\n📦 **Items**: See attached PDF for complete details\n\nClick the link above to download the full sales order!",
  },
  {
    patterns: [
      /technical proposal.*tall grass 8 jm/i,
      /find.*tall grass 8 jm/i,
      /find.*technical proposal.*tall grass 8 jm/i,
      /find.*technical proposal.*tall grass/i,
      /tall grass 8 jm.*proposal/i,
      /proposal.*tall grass/i,
      /tall grass 8/i,
    ],
    keywords: ["technical", "proposal", "tall", "grass", "8", "jm", "find"],
    response:
      "I found the Technical Proposal for Tall Grass 8 JM! 📄\n\n🔗 [Download TECHNICAL PROPOSAL TALL GRASS 8JM.pdf](/documents/TECHNICAL%20PROPOSAL%20TALL%20GRASS%208JM.pdf)\n\n🛢️ **Well**: Tall Grass 8 JM\n📋 **Type**: Technical Proposal\n💡 **Solution**: Complete technical specifications included\n\nClick the link above to download the full technical proposal!",
  },
  {
    patterns: [
      /pump tracker/i,
      /show.*pump tracker/i,
      /find.*pump tracker/i,
      /pull.*pump tracker/i,
    ],
    keywords: ["pump", "tracker", "find", "show", "pull"],
    response:
      "I found the Pump Tracker document! 📊\n\n🔗 [Download PUMP TRACKER.pdf](/documents/PUMP%20TRACKER.pdf)\n\n📈 **Type**: Pump Tracking Report\n🔧 **Contents**: Complete pump monitoring data\n\nClick the link above to download the pump tracker!",
  },
  {
    patterns: [
      /pull.*teardown report.*diamondback/i,
      /teardown report.*diamondback.*db-123/i,
      /teardown.*diamondback.*db.*123/i,
      /diamondback.*db-123.*teardown/i,
      /diamondback.*db.*123.*report/i,
    ],
    keywords: ["pull", "teardown", "report", "diamondback", "db", "123"],
    response:
      "I found the Teardown Report for Diamondback DB-123! 🔧\n\n🔗 [Download PUMP TRACKER.pdf](/documents/PUMP%20TRACKER.pdf)\n\n🏢 **Customer**: Diamondback\n📄 **Equipment**: DB-123\n📋 **Type**: Teardown Report\n🔍 **Contents**: Complete teardown analysis and findings\n\nClick the link above to download the teardown report!",
  },
  {
    patterns: [
      /chemical tracker/i,
      /ovintiv.*tracker/i,
      /show.*chemical tracker/i,
      /find.*chemical tracker/i,
      /find.*last.*chemical tracker.*ovintiv/i,
      /last.*chemical tracker.*ovintiv/i,
      /chemical tracker.*ovintiv.*hz/i,
    ],
    keywords: ["chemical", "tracker", "ovintiv", "hz", "find", "last"],
    response:
      "I found the Chemical Tracker for Ovintiv HZ! 🧪\n\n🔗 [Download Chemical Tracker-Ovintiv HZ.pdf](/documents/Chemical%20Tracker-Ovintiv%20HZ.pdf)\n\n🏢 **Customer**: Ovintiv\n🛢️ **Field**: HZ\n📊 **Type**: Chemical Tracking Report\n\nClick the link above to download the chemical tracker!",
  },
  {
    patterns: [
      /who we are/i,
      /company.*overview/i,
      /osi.*presentation/i,
      /company.*presentation/i,
      /about.*osi.*pdf/i,
      /pull.*latest.*presentation.*who we are/i,
      /pull.*who we are.*presentation/i,
      /latest.*presentation.*who we are/i,
      /latest.*who we are/i,
    ],
    keywords: [
      "who",
      "we",
      "are",
      "overview",
      "presentation",
      "company",
      "pull",
      "latest",
    ],
    response:
      "Here's our company overview presentation! 📊\n\n🔗 [Download WHO WE ARE 2025 ENG.pdf](/documents/WHO%20WE%20ARE%202025%20ENG.pdf)\n\n🏢 **Document**: Company Overview 2025\n🌐 **Language**: English\n📋 **Contents**: Complete OSI company profile and capabilities\n\nClick the link above to download the presentation!",
  },
  {
    patterns: [
      /look for.*last.*failure meeting.*diamondback/i,
      /last.*failure meeting.*report.*diamondback/i,
      /failure meeting.*diamondback/i,
      /diamondback.*failure meeting/i,
      /srrr.*failure.*meeting/i,
      /ritthy.*ferris/i,
    ],
    keywords: [
      "look",
      "last",
      "failure",
      "meeting",
      "report",
      "diamondback",
      "srrr",
      "ritthy",
      "ferris",
    ],
    response:
      "I found the last Failure Meeting Report sent to Diamondback! 📄\n\n🔗 [Download SRRR Failure meeting RitthyFerris - OK.pdf](/documents/SRRR%20Failure%20meeting%20RitthyFerris%20-%20OK.pdf)\n\n🏢 **Customer**: Diamondback\n📋 **Type**: SRRR Failure Meeting Report\n👥 **Contact**: Ritthy Ferris\n✅ **Status**: OK\n\nClick the link above to download the failure meeting report!",
  },
  {
    patterns: [
      /find.*latest.*two papers.*gas separation.*esp/i,
      /latest.*two papers.*gas separation/i,
      /latest.*papers.*gas.*esp/i,
      /gas separation.*esp.*papers/i,
      /two papers.*gas.*separation/i,
      /swpsc.*gas/i,
    ],
    keywords: [
      "find",
      "latest",
      "two",
      "papers",
      "gas",
      "separation",
      "esp",
      "swpsc",
    ],
    response:
      "I found the latest two papers for Gas Separation on ESP! 📚\n\n📄 **Paper 1 (2017):**\n🔗 [Download SWPSC2017009-SAND CONTROL ESP.pdf](/documents/SWPSC2017009-SAND%20CONTROL%20ESP.pdf)\n\n📄 **Paper 2 (2018):**\n🔗 [Download SWPSC2018012-NEW GAS MITIGATION SOLUTION.pdf](/documents/SWPSC2018012-NEW%20GAS%20MITIGATION%20SOLUTION.pdf)\n\n🔬 **Topic**: Gas Separation & ESP Technology\n📅 **Years**: 2017-2018\n💡 **Contents**: Sand control and gas mitigation solutions for ESP systems\n\nClick the links above to download both technical papers!",
  },
];

export const fallbackResponse =
  "This capability will be implemented in a future AI-powered version of the OSI Assistant.";
