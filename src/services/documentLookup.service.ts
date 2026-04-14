import fs from "fs";
import path from "path";
import logger from "../utils/logger";
import { ChatResponse } from "../types/chatbot.types";

/**
 * Known document metadata for richer responses.
 * Key = filename (case-insensitive match), value = display metadata.
 */
interface DocumentMeta {
  label: string;
  details?: string;
}

const DOCUMENT_META: Record<string, DocumentMeta> = {
  "so29311.pdf": {
    label: "Sales Order SO29311",
    details:
      "🏢 **Customer**: OXYROCK\n🛢️ **Well**: YAMAHA PACIFICA 10HA",
  },
  "so29311[71].pdf": {
    label: "Sales Order SO29311 (Rev 71)",
    details:
      "🏢 **Customer**: OXYROCK\n🛢️ **Well**: YAMAHA PACIFICA 10HA",
  },
  "so29383.pdf": {
    label: "Sales Order SO29383",
    details:
      "🏢 **Customer**: Permian Resources Operating\n🛢️ **Well**: Batman 113H\n💰 **Total**: $16,616.38",
  },
  "so29397.pdf": {
    label: "Sales Order SO29397",
    details:
      "🏢 **Customer**: Black Swan Operating, LLC\n🛢️ **Well**: UL 8-4 4WB\n💰 **Total**: $34,007.90",
  },
  "i529284 - antietam f 11hb.pdf": {
    label: "Invoice I529284 — Antietam F #11HB",
    details:
      "🏢 **Customer**: OXY Rock Operating\n🛢️ **Well**: Antietam F #11HB\n💰 **Total**: $18,254.70",
  },
  "technical proposal tall grass 8jm.pdf": {
    label: "Technical Proposal — Tall Grass 8 JM",
    details:
      "🛢️ **Well**: Tall Grass 8 JM\n📋 **Type**: Technical Proposal",
  },
  "technical proposal tall grass 8jm[60].pdf": {
    label: "Technical Proposal — Tall Grass 8 JM (Rev 60)",
    details:
      "🛢️ **Well**: Tall Grass 8 JM\n📋 **Type**: Technical Proposal",
  },
  "pump tracker.pdf": {
    label: "Pump Tracker Report",
    details: "📈 **Type**: Pump Tracking Report",
  },
  "chemical tracker-ovintiv hz.pdf": {
    label: "Chemical Tracker — Ovintiv HZ",
    details: "📋 **Type**: Chemical Tracker Report",
  },
  "srrr failure meeting ritthyferris - ok.pdf": {
    label: "SRRR Failure Meeting Report — Ritthy Ferris",
    details:
      "🏢 **Customer**: Diamondback\n👥 **Contact**: Ritthy Ferris\n✅ **Status**: OK",
  },
  "swpsc2017009-sand control esp.pdf": {
    label: "SWPSC 2017-009 — Sand Control ESP",
    details: "🔬 **Topic**: Sand Control & ESP Technology (2017)",
  },
  "swpsc2018012-new gas mitigation solution.pdf": {
    label: "SWPSC 2018-012 — New Gas Mitigation Solution",
    details: "🔬 **Topic**: Gas Mitigation Solutions (2018)",
  },
  "who we are 2025 eng.pdf": {
    label: "WHO WE ARE 2025 — Company Overview",
    details: "🏢 **Document**: Company Overview 2025\n🌐 **Language**: English",
  },
};

/**
 * DocumentLookupService
 *
 * Scans the client/public/documents folder at startup and provides instant
 * document retrieval when the user references a filename, SO number, invoice
 * number, or document keyword. This runs BEFORE n8n or any AI provider so
 * document queries get an immediate, zero-cost response.
 */
class DocumentLookupService {
  private documents: string[] = [];
  private documentsDir: string;

  constructor() {
    // Resolve path relative to server/ → ../client/public/documents
    this.documentsDir = path.resolve(
      __dirname,
      "../../..",
      "client/public/documents",
    );
    this.loadDocuments();
  }

  /** Read the documents directory once at startup */
  private loadDocuments(): void {
    try {
      if (!fs.existsSync(this.documentsDir)) {
        logger.warn(
          `Documents directory not found: ${this.documentsDir}`,
        );
        return;
      }

      this.documents = fs
        .readdirSync(this.documentsDir)
        .filter((f) => f.toLowerCase().endsWith(".pdf"));

      logger.info(
        `DocumentLookupService: loaded ${this.documents.length} documents`,
      );
    } catch (error) {
      logger.error("DocumentLookupService: failed to load documents", error);
    }
  }

  /** Allow hot-reload if documents change */
  refresh(): void {
    this.loadDocuments();
  }

  /**
   * Try to match the user message to one or more local documents.
   * Returns a ChatResponse if matched, or null to let the next provider handle it.
   */
  lookup(message: string): ChatResponse | null {
    if (!this.documents.length) return null;

    const msg = message.trim().toLowerCase();

    // ── 1. Extract identifiers from message ──────────────────────────
    // SO numbers: SO29311, SO 29311, sales order 29311
    const soMatch = msg.match(/\bso\s*(\d{4,6})\b/) ||
      msg.match(/\bsales\s+order\s+(\d{4,6})\b/);

    // Invoice numbers: I529284, invoice 529284
    const invMatch = msg.match(/\bi(\d{5,7})\b/) ||
      msg.match(/\binvoice\s*(\d{5,7})\b/);

    // SWPSC papers
    const swpscMatch = msg.match(/\bswpsc\s*(\d+)\b/);

    // ── 2. Try exact identifier matches first ────────────────────────
    if (soMatch) {
      const soNum = soMatch[1];
      const hits = this.documents.filter((f) => {
        const lower = f.toLowerCase();
        return lower.startsWith(`so${soNum}`);
      });
      if (hits.length) return this.buildResponse(hits);
    }

    if (invMatch) {
      const invNum = invMatch[1];
      const hits = this.documents.filter((f) =>
        f.toLowerCase().startsWith(`i${invNum}`),
      );
      if (hits.length) return this.buildResponse(hits);
    }

    if (swpscMatch) {
      const num = swpscMatch[1];
      const hits = this.documents.filter((f) =>
        f.toLowerCase().includes(`swpsc${num}`),
      );
      if (hits.length) return this.buildResponse(hits);
    }

    // ── 3. Keyword-based fuzzy match ─────────────────────────────────
    // Extract meaningful words (3+ chars, skip stop words)
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

    // Score each document by how many query words appear in its filename
    const scored = this.documents
      .map((filename) => {
        const lower = filename.toLowerCase().replace(/[^\w\s]/g, " ");
        const matched = words.filter((w) => lower.includes(w));
        return { filename, score: matched.length };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    // Require at least 1 meaningful word match AND a decent ratio
    if (scored.length && scored[0].score >= 1) {
      // If top score is well ahead, return just the best match(es)
      const topScore = scored[0].score;
      const topHits = scored
        .filter((s) => s.score === topScore)
        .map((s) => s.filename);
      return this.buildResponse(topHits);
    }

    return null;
  }

  /** Build a user-friendly response for matched documents */
  private buildResponse(filenames: string[]): ChatResponse {
    if (filenames.length === 1) {
      return this.singleDocResponse(filenames[0]);
    }
    return this.multiDocResponse(filenames);
  }

  private singleDocResponse(filename: string): ChatResponse {
    const meta = DOCUMENT_META[filename.toLowerCase()];
    const encodedName = encodeURIComponent(filename).replace(/%20/g, "%20");
    const downloadLink = `/documents/${encodedName}`;
    const label = meta?.label || filename.replace(/\.pdf$/i, "");

    let reply = `I found ${label}! 📄\n\n🔗 [Download ${filename}](${downloadLink})`;

    if (meta?.details) {
      reply += `\n\n${meta.details}`;
    }

    reply += "\n\nClick the link above to download the document!";

    return {
      reply,
      timestamp: new Date(),
      confidence: 1.0,
    };
  }

  private multiDocResponse(filenames: string[]): ChatResponse {
    let reply = `I found ${filenames.length} matching documents! 📄\n`;

    for (const filename of filenames) {
      const meta = DOCUMENT_META[filename.toLowerCase()];
      const encodedName = encodeURIComponent(filename).replace(/%20/g, "%20");
      const downloadLink = `/documents/${encodedName}`;
      const label = meta?.label || filename.replace(/\.pdf$/i, "");

      reply += `\n📄 **${label}**\n🔗 [Download ${filename}](${downloadLink})`;
      if (meta?.details) {
        reply += `\n${meta.details}`;
      }
      reply += "\n";
    }

    reply += "\nClick any link above to download!";

    return {
      reply,
      timestamp: new Date(),
      confidence: 1.0,
    };
  }
}

export const documentLookupService = new DocumentLookupService();
