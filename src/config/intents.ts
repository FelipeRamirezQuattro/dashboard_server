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
  {
    patterns: [
      /so29383/i,
      /sales order 29383/i,
      /order 29383/i,
      /pull.*so29383/i,
      /show.*so29383/i,
      /permian resources.*batman 113h/i,
      /batman 113h/i,
      /permian resources.*operating/i,
      /permian.*order/i,
      /permian.*sales/i,
      /find.*permian/i,
      /esp sand lift.*permian/i,
    ],
    keywords: [
      "so29383",
      "29383",
      "permian",
      "resources",
      "batman",
      "113h",
      "esp",
      "sand",
      "lift",
      "order",
      "sales",
    ],
    response:
      "I found Sales Order SO29383 for Permian Resources! 📄\n\n🔗 [Download SO29383.pdf](/documents/SO29383.pdf)\n\n🏢 **Customer**: Permian Resources Operating\n🛢️ **Well**: Batman 113H\n👤 **Contact**: Julio Molina (432-212-6522)\n📅 **Delivery**: 3/10/2026\n💰 **Total**: $16,616.38\n\n📦 **Main Items**:\n• ESP Sand Lift 400 Series L\n• 2-7/8\" x 4' L80 Pup Joint, Box x Pin\n\nClick the link above to download the full sales order!",
  },
  {
    patterns: [
      /so29397/i,
      /sales order 29397/i,
      /order 29397/i,
      /pull.*so29397/i,
      /show.*so29397/i,
      /black swan.*ul 8-4 4wb/i,
      /ul 8-4 4wb/i,
      /black swan operating/i,
      /black swan.*order/i,
      /black swan.*sales/i,
      /find.*black swan/i,
      /brandon stillwell/i,
    ],
    keywords: [
      "so29397",
      "29397",
      "black",
      "swan",
      "ul",
      "8-4",
      "4wb",
      "brandon",
      "stillwell",
      "order",
      "sales",
    ],
    response:
      "I found Sales Order SO29397 for Black Swan Operating! 📄\n\n🔗 [Download SO29397.pdf](/documents/SO29397.pdf)\n\n🏢 **Customer**: Black Swan Operating, LLC\n🛢️ **Well**: UL 8-4 4WB\n👤 **Contact**: Brandon Stillwell (+1 785-738-8027)\n📅 **Delivery**: 3/11/2026 6:00 PM\n💰 **Total**: $34,007.90\n\n📦 **Main Items** (14 line items):\n• Dual Flow Tubing Screens (multiple)\n• Single String Double Seal Cup Packer\n• Vortex Kit with HE 2.9 Helix\n• Chemical Screen Assembly\n• After Hours Delivery\n\nClick the link above to download the complete sales order!",
  },
  {
    patterns: [
      /i529284/i,
      /invoice 529284/i,
      /invoice.*529284/i,
      /antietam f.*11hb/i,
      /antietam.*11hb/i,
      /oxy rock.*antietam/i,
      /oxyrock.*antietam/i,
      /antietam.*invoice/i,
      /oxy rock.*invoice/i,
      /find.*antietam/i,
      /pull.*invoice.*antietam/i,
      /show.*invoice.*antietam/i,
    ],
    keywords: [
      "i529284",
      "529284",
      "invoice",
      "antietam",
      "11hb",
      "oxy",
      "rock",
      "oxyrock",
    ],
    response:
      'I found Invoice I529284 for OXY Rock Operating! 📄\n\n🔗 [Download I529284 - ANTIETAM F 11HB.pdf](/documents/I529284%20-%20ANTIETAM%20F%2011HB.pdf)\n\n🏢 **Customer**: OXY Rock Operating\n🛢️ **Well**: Antietam F #11HB\n📅 **Invoice Date**: 2/25/2026\n📋 **Related SO**: SO29137\n💰 **Total**: $18,254.70\n💳 **Terms**: Net 30\n\n📦 **Main Items**:\n• 2-7/8" x 24\' Chem Tool Valve Assemblies (3 units)\n• 2-7/8" x 5-1/2" x 18\' ESP Vortex Desander w/ 2.9 Helix\n• End User Delivery Charge\n\nClick the link above to download the complete invoice!',
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
