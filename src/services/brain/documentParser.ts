/// <reference types="node" />
import matter from "gray-matter";

export type DocKind = "facts" | "guidance" | "glossary" | "procedure";

export interface DocSection {
  heading: string;
  text: string;
  page?: number;
}

export interface InjectionFlag {
  id: string;
  line: number;
  excerpt: string;
}

/** `code` is a plain string: other tasks add NO_EXTRACTABLE_TEXT, TOO_MANY_PAGES, FLAGS_NOT_ACKNOWLEDGED. */
export class DocumentError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DocumentError";
    this.code = code;
    Object.setPrototypeOf(this, DocumentError.prototype);
  }
}

const KINDS: DocKind[] = ["facts", "guidance", "glossary", "procedure"];
export const MAX_MARKDOWN_BYTES = 200 * 1024;

/** Strips HTML (incl. script/style contents), images, link URLs and emphasis markers. Keeps text, headings, lists, tables. */
export const sanitizeText = (text: string): string => {
  let out = text;
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  // unterminated script/style: drop everything after the opening tag
  out = out.replace(/<(script|style)\b[\s\S]*$/gi, "");
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // inline images
  out = out.replace(/!\[[^\]]*\]\[[^\]]*\]/g, ""); // reference images
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // links: keep text
  out = out.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  out = out.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, ""); // reference definitions
  out = out.replace(/<\/?[a-zA-Z!?][^>]*>/g, ""); // remaining tags and autolinks
  out = out.replace(/<\/?[a-zA-Z!?][^>]*$/gm, ""); // unterminated tag at line end
  out = out.replace(/\bhttps?:\/\/\S+/gi, ""); // raw links
  out = out.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/~~(.+?)~~/g, "$1");
  out = out.replace(/(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g, "$1");
  return out
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const toTags = (value: unknown): string[] => {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return list.map((tag) => String(tag).trim()).filter(Boolean);
};

const optionalString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
};

export const parseMarkdownDocument = (
  raw: string,
): {
  meta: { title: string; kind: DocKind; version?: string; tags: string[]; source?: string };
  sections: { heading: string; text: string }[];
} => {
  if (Buffer.byteLength(raw, "utf8") > MAX_MARKDOWN_BYTES) {
    throw new DocumentError("TOO_LARGE", "Markdown documents must be 200 KB or smaller.");
  }
  if (!/^﻿?---[ \t]*\r?\n/.test(raw)) {
    throw new DocumentError("MISSING_FRONT_MATTER", "Markdown documents must start with YAML front matter.");
  }
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw, { excerpt: false });
  } catch {
    throw new DocumentError("MISSING_FRONT_MATTER", "The YAML front matter could not be parsed.");
  }
  const data: Record<string, unknown> = { ...(parsed.data || {}) };
  const title = optionalString(data.title);
  if (!title) throw new DocumentError("MISSING_TITLE", "Front matter must include a title.");
  const kind = optionalString(data.kind);
  if (!kind || !KINDS.includes(kind as DocKind)) {
    throw new DocumentError("INVALID_KIND", `Front matter kind must be one of: ${KINDS.join(", ")}.`);
  }
  const meta: { title: string; kind: DocKind; version?: string; tags: string[]; source?: string } = {
    title,
    kind: kind as DocKind,
    tags: toTags(data.tags),
  };
  const version = optionalString(data.version);
  if (version) meta.version = version;
  const source = optionalString(data.source);
  if (source) meta.source = source;

  const sections: { heading: string; text: string }[] = [];
  let heading = title;
  let lines: string[] = [];
  let fence = false;
  const flush = (): void => {
    const text = sanitizeText(lines.join("\n"));
    if (text) sections.push({ heading, text });
    lines = [];
  };
  for (const line of parsed.content.split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(line)) fence = !fence;
    const match = !fence ? /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line) : null;
    if (match) {
      flush();
      heading = sanitizeText(match[1]);
    } else {
      lines.push(line);
    }
  }
  flush();
  return { meta, sections };
};

const SENTENCE_SPLIT = /(?<=[.!?]["')\]]*)\s+/;

// Splits text into <= max pieces: paragraph, then sentence, then whitespace, then hard cut.
const splitLevel = (text: string, max: number, level: number): string[] => {
  if (text.length <= max) return text ? [text] : [];
  if (level >= 3) {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
    return out;
  }
  const sep = level === 0 ? "\n\n" : " ";
  const parts = level === 0 ? text.split(/\n\s*\n/) : level === 1 ? text.split(SENTENCE_SPLIT) : text.split(/\s+/);
  const pieces = parts.map((p) => p.trim()).filter(Boolean).flatMap((p) => splitLevel(p, max, level + 1));
  const out: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (!current) current = piece;
    else if (current.length + sep.length + piece.length <= max) current += sep + piece;
    else {
      out.push(current);
      current = piece;
    }
  }
  if (current) out.push(current);
  return out;
};

export const chunkSections = (sections: DocSection[], maxChars = 2000): DocSection[] => {
  const out: DocSection[] = [];
  for (const section of sections) {
    for (const text of splitLevel(section.text.trim(), maxChars, 0)) {
      const chunk: DocSection = { heading: section.heading, text };
      if (section.page !== undefined) chunk.page = section.page;
      out.push(chunk);
    }
  }
  return out;
};

// Conservative, instruction-shaped patterns (case-insensitive). Each requires the verb AND its
// instruction-like object so ordinary prose ("ignore previous inspection records",
// "you are now ready") is not flagged; "ignore previous instructions" in any context is flagged on purpose.
const INJECTION_PATTERNS: { id: string; re: RegExp }[] = [
  {
    id: "ignore_previous",
    re: /\bignor(?:e|ing)\s+(?:(?:all|any|the|your|of)\s+)*(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|prompts?|rules?|messages?|directions?|context)\b/i,
  },
  { id: "role_override", re: /\byou\s+are\s+now\s+(?:the|a|an|my|in|acting|dan)\b/i },
  {
    id: "disregard_rules",
    re: /\b(?:disregard|forget|override)\s+(?:(?:all|any|the|your|these|those|previous)\s+)*(?:rules?|instructions?|guidelines?|polic(?:y|ies)|constraints)\b/i,
  },
  {
    id: "reveal_prompt",
    re: /\b(?:reveal|show|print|repeat|output|leak|disclose|display)\s+(?:me\s+)?(?:(?:your|the)\s+(?:system|hidden|initial|original|secret)\s+(?:prompt|instructions?)|your\s+(?:prompt|instructions?))\b/i,
  },
];

export const scanForInjection = (text: string): InjectionFlag[] => {
  const flags: InjectionFlag[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const { id, re } of INJECTION_PATTERNS) {
      if (re.test(line)) flags.push({ id, line: index + 1, excerpt: line.trim().slice(0, 80) });
    }
  });
  return flags;
};

export const flagKey = (flag: { id: string; line: number }): string => `${flag.id}:${flag.line}`;
