import mongoose from "mongoose";
import FileBank, { IFileBank } from "../models/FileBank.model";
import { ChatDocumentResult, ChatResponse } from "../types/chatbot.types";
import logger from "../utils/logger";

export interface DocumentSearchResult extends ChatDocumentResult {
  score: number;
}

const DOCUMENT_QUERY_RE =
  /\b(file|document|pdf|report|proposal|invoice|sales\s*order|download|open|find|pull|show|latest|presentation|paper|manual|spec|certificate|safety)\b/i;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const tokenize = (query: string): string[] =>
  query
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3)
    .filter(
      (word) =>
        ![
          "the",
          "and",
          "for",
          "can",
          "you",
          "please",
          "from",
          "with",
          "that",
          "this",
          "file",
          "document",
          "show",
          "find",
          "pull",
          "open",
          "download",
        ].includes(word),
    );

const toDocumentResult = (
  file: Pick<
    IFileBank,
    | "_id"
    | "originalName"
    | "downloadUrl"
    | "webUrl"
    | "source"
    | "description"
    | "tags"
  >,
  score: number,
): DocumentSearchResult => {
  const source = file.source || "local";
  return {
    id: String(file._id),
    name: file.originalName,
    url: source === "onedrive" && file.webUrl ? file.webUrl : file.downloadUrl,
    source,
    description: file.description,
    tags: file.tags,
    score,
  };
};

class DocumentSearchService {
  isDocumentRequest(message: string): boolean {
    return DOCUMENT_QUERY_RE.test(message);
  }

  async search(
    query: string,
    limit = 5,
    source?: "local" | "onedrive",
  ): Promise<DocumentSearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const textResults = await this.textSearch(trimmed, limit, source);
    if (textResults.length) {
      return textResults;
    }

    return this.regexSearch(trimmed, limit, source);
  }

  toChatResponse(results: DocumentSearchResult[]): ChatResponse | null {
    if (!results.length) return null;

    const docs = results.map(({ score: _score, ...doc }) => doc);
    const source = docs.some((doc) => doc.source === "onedrive")
      ? "onedrive"
      : "file_bank";

    if (docs.length === 1) {
      const doc = docs[0];
      const label = doc.source === "onedrive" ? "OneDrive" : "File Bank";
      let reply = `I found a matching document in ${label}:\n\n📄 **${doc.name}**`;
      if (doc.description) reply += `\n${doc.description}`;
      if (doc.tags?.length) reply += `\nTags: ${doc.tags.join(", ")}`;
      reply += `\n\n🔗 [Open ${doc.name}](${doc.url})`;

      return {
        reply,
        timestamp: new Date(),
        confidence: 0.92,
        source,
        routedTo: doc.source,
        documents: docs,
      };
    }

    let reply = `I found ${docs.length} matching documents:\n`;
    for (const doc of docs) {
      const label = doc.source === "onedrive" ? "OneDrive" : "File Bank";
      reply += `\n📄 **${doc.name}** (${label})\n🔗 [Open ${doc.name}](${doc.url})\n`;
    }

    return {
      reply,
      timestamp: new Date(),
      confidence: 0.9,
      source,
      routedTo: "documents",
      documents: docs,
    };
  }

  private async textSearch(
    query: string,
    limit: number,
    source?: "local" | "onedrive",
  ): Promise<DocumentSearchResult[]> {
    try {
      const results = await FileBank.find(
        {
          ...(source ? { source } : {}),
          $text: { $search: query },
        },
        { score: { $meta: "textScore" } },
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(limit)
        .lean();

      return results
        .map((file) => toDocumentResult(file as unknown as IFileBank, (file as any).score || 0))
        .filter((file) => file.score >= 0.5);
    } catch (error) {
      if (
        error instanceof mongoose.Error ||
        (error as Error).message?.includes("text index")
      ) {
        logger.warn("FileBank text index unavailable; using fallback search");
      } else {
        logger.error("Document text search failed:", error);
      }
      return [];
    }
  }

  private async regexSearch(
    query: string,
    limit: number,
    source?: "local" | "onedrive",
  ): Promise<DocumentSearchResult[]> {
    const words = tokenize(query);
    if (!words.length) return [];

    const regexes = words.slice(0, 8).map((word) => new RegExp(escapeRegExp(word), "i"));
    const files = await FileBank.find({
      ...(source ? { source } : {}),
      $or: regexes.flatMap((regex) => [
        { originalName: regex },
        { description: regex },
        { tags: regex },
        { contentText: regex },
      ]),
    })
      .limit(25)
      .lean();

    return files
      .map((file) => {
        const haystack = [
          file.originalName,
          file.description,
          ...(file.tags || []),
          file.contentText || "",
        ]
          .join(" ")
          .toLowerCase();
        const score = words.reduce(
          (total, word) => total + (haystack.includes(word) ? 1 : 0),
          0,
        );
        return toDocumentResult(file as unknown as IFileBank, score);
      })
      .filter((file) => file.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

export const documentSearchService = new DocumentSearchService();
