import logger from "../utils/logger";
import { ChatResponse } from "../types/chatbot.types";

/**
 * Known document metadata for richer responses.
 * Key = lowercase filename as it exists in client/public/documents/.
 * The actual files are served by the frontend (Vite/nginx), so the server
 * only needs this static registry — no filesystem access required.
 */
interface DocumentMeta {
  /** Original filename with correct casing (used in download links) */
  filename: string;
  label: string;
  details?: string;
}

const DOCUMENT_REGISTRY: DocumentMeta[] = [
  {
    filename: "SO29311.pdf",
    label: "Sales Order SO29311",
    details: "🏢 **Customer**: OXYROCK\n🛢️ **Well**: YAMAHA PACIFICA 10HA",
  },
  {
    filename: "SO29311[71].pdf",
    label: "Sales Order SO29311 (Rev 71)",
    details: "🏢 **Customer**: OXYROCK\n🛢️ **Well**: YAMAHA PACIFICA 10HA",
  },
  {
    filename: "SO29383.pdf",
    label: "Sales Order SO29383",
    details:
      "🏢 **Customer**: Permian Resources Operating\n🛢️ **Well**: Batman 113H\n💰 **Total**: $16,616.38",
  },
  {
    filename: "SO29397.pdf",
    label: "Sales Order SO29397",
    details:
      "🏢 **Customer**: Black Swan Operating, LLC\n🛢️ **Well**: UL 8-4 4WB\n💰 **Total**: $34,007.90",
  },
  {
    filename: "I529284 - ANTIETAM F 11HB.pdf",
    label: "Invoice I529284 — Antietam F #11HB",
    details:
      "🏢 **Customer**: OXY Rock Operating\n🛢️ **Well**: Antietam F #11HB\n💰 **Total**: $18,254.70",
  },
  {
    filename: "TECHNICAL PROPOSAL TALL GRASS 8JM.pdf",
    label: "Technical Proposal — Tall Grass 8 JM",
    details: "🛢️ **Well**: Tall Grass 8 JM\n📋 **Type**: Technical Proposal",
  },
  {
    filename: "TECHNICAL PROPOSAL TALL GRASS 8JM[60].pdf",
    label: "Technical Proposal — Tall Grass 8 JM (Rev 60)",
    details: "🛢️ **Well**: Tall Grass 8 JM\n📋 **Type**: Technical Proposal",
  },
  {
    filename: "PUMP TRACKER.pdf",
    label: "Pump Tracker Report",
    details: "📈 **Type**: Pump Tracking Report",
  },
  {
    filename: "Chemical Tracker-Ovintiv HZ.pdf",
    label: "Chemical Tracker — Ovintiv HZ",
    details: "📋 **Type**: Chemical Tracker Report",
  },
  {
    filename: "SRRR Failure meeting RitthyFerris - OK.pdf",
    label: "SRRR Failure Meeting Report — Ritthy Ferris",
    details:
      "🏢 **Customer**: Diamondback\n👥 **Contact**: Ritthy Ferris\n✅ **Status**: OK",
  },
  {
    filename: "SWPSC2017009-SAND CONTROL ESP.pdf",
    label: "SWPSC 2017-009 — Sand Control ESP",
    details: "🔬 **Topic**: Sand Control & ESP Technology (2017)",
  },
  {
    filename: "SWPSC2018012-NEW GAS MITIGATION SOLUTION.pdf",
    label: "SWPSC 2018-012 — New Gas Mitigation Solution",
    details: "🔬 **Topic**: Gas Mitigation Solutions (2018)",
  },
  {
    filename: "WHO WE ARE 2025 ENG.pdf",
    label: "WHO WE ARE 2025 — Company Overview",
    details:
      "🏢 **Document**: Company Overview 2025\n🌐 **Language**: English",
  },
];

/**
 * DocumentLookupService
 *
 * Uses a static registry of documents hosted in client/public/documents/.
 * Matches user messages against document filenames, SO numbers, invoice
 * numbers, or keywords. Runs BEFORE n8n or any AI provider so document
 * queries get an immediate, zero-cost response.
 */
class DocumentLookupService {
  private documents: DocumentMeta[];

  constructor() {
    this.documents = DOCUMENT_REGISTRY;
    logger.info(
      `DocumentLookupService: registry has ${this.documents.length} documents`,
    );
  }

  /**
   * Try to match the user message to one or more local documents.
   * Returns a ChatResponse if matched, or null to let the next provider handle it.
   */
  lookup(message: string): ChatResponse | null {
    if (!this.documents.length) return null;

    const msg = message.trim().toLowerCase();

    // ── 1. Extract identifiers from message ──────────────────────────
    const soMatch =
      msg.match(/\bso\s*(\d{4,6})\b/) ||
      msg.match(/\bsales\s+order\s+(\d{4,6})\b/);

    const invMatch =
      msg.match(/\bi(\d{5,7})\b/) ||
      msg.match(/\binvoice\s*(\d{5,7})\b/);

    const swpscMatch = msg.match(/\bswpsc\s*(\d+)\b/);

    // ── 2. Try exact identifier matches first ────────────────────────
    if (soMatch) {
      const soNum = soMatch[1];
      const hits = this.documents.filter((d) =>
        d.filename.toLowerCase().startsWith(`so${soNum}`),
      );
      if (hits.length) return this.buildResponse(hits);
    }

    if (invMatch) {
      const invNum = invMatch[1];
      const hits = this.documents.filter((d) =>
        d.filename.toLowerCase().startsWith(`i${invNum}`),
      );
      if (hits.length) return this.buildResponse(hits);
    }

    if (swpscMatch) {
      const num = swpscMatch[1];
      const hits = this.documents.filter((d) =>
        d.filename.toLowerCase().includes(`swpsc${num}`),
      );
      if (hits.length) return this.buildResponse(hits);
    }

    // ── 3. Keyword-based fuzzy match ─────────────────────────────────
    const stopWords = new Set([
      "the", "for", "and", "can", "you", "pull", "show", "find",
      "get", "give", "look", "open", "download", "display", "fetch",
      "from", "with", "that", "this", "have", "what", "where",
      "please", "latest", "last", "first", "most", "recent",
    ]);
    const words = msg
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopWords.has(w));

    if (words.length === 0) return null;

    const scored = this.documents
      .map((doc) => {
        const lower = doc.filename.toLowerCase().replace(/[^\w\s]/g, " ");
        const matched = words.filter((w) => lower.includes(w));
        return { doc, score: matched.length };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length && scored[0].score >= 1) {
      const topScore = scored[0].score;
      const topHits = scored
        .filter((s) => s.score === topScore)
        .map((s) => s.doc);
      return this.buildResponse(topHits);
    }

    return null;
  }

  /** Build a user-friendly response for matched documents */
  private buildResponse(docs: DocumentMeta[]): ChatResponse {
    if (docs.length === 1) {
      return this.singleDocResponse(docs[0]);
    }
    return this.multiDocResponse(docs);
  }

  private singleDocResponse(doc: DocumentMeta): ChatResponse {
    const encodedName = encodeURIComponent(doc.filename);
    const downloadLink = `/documents/${encodedName}`;

    let reply = `I found ${doc.label}! 📄\n\n🔗 [Download ${doc.filename}](${downloadLink})`;

    if (doc.details) {
      reply += `\n\n${doc.details}`;
    }

    reply += "\n\nClick the link above to download the document!";

    return { reply, timestamp: new Date(), confidence: 1.0 };
  }

  private multiDocResponse(docs: DocumentMeta[]): ChatResponse {
    let reply = `I found ${docs.length} matching documents! 📄\n`;

    for (const doc of docs) {
      const encodedName = encodeURIComponent(doc.filename);
      const downloadLink = `/documents/${encodedName}`;

      reply += `\n📄 **${doc.label}**\n🔗 [Download ${doc.filename}](${downloadLink})`;
      if (doc.details) {
        reply += `\n${doc.details}`;
      }
      reply += "\n";
    }

    reply += "\nClick any link above to download!";

    return { reply, timestamp: new Date(), confidence: 1.0 };
  }
}

export const documentLookupService = new DocumentLookupService();
