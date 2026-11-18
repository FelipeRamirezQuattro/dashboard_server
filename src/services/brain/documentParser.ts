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

// ---- HTML stripping: one linear scan (final review I1). A "<" starts markup only when it really is markup:
//  - "<!--" ... "-->" (an unterminated comment hides the rest, as in a browser);
//  - <script ...> / <style ...> (complete opening tag) through the matching close tag; contents removed, an unclosed
//    block drops the rest;
//  - "<" + optional "/" + a KNOWN HTML element name + whitespace, "/" or ">", closed by ">" within TAG_LOOKAHEAD chars;
//  - "<!DOCTYPE ...>", "<?xml ...?>" and autolinks "<https://...>" / "<mailto:...>" (">" within TAG_LOOKAHEAD).
// Anything else ("iron <LOD; ...", "a < b", "x<5", "<LOD, copper >5") is literal text. Every lookahead is bounded or
// cached (the next ">" index only moves forward), so the scan is linear in the input.
const TAG_LOOKAHEAD = 500;
const HTML_ELEMENTS: ReadonlySet<string> = new Set(
  ("a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption center cite code col " +
    "colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure font footer form frame " +
    "frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark " +
    "marquee menu meta meter nav noscript object ol optgroup option output p param picture pre progress q rp rt ruby s samp " +
    "script section select slot small source span strike strong style sub summary sup svg table tbody td template textarea " +
    "tfoot th thead time title tr track tt u ul var video wbr math").split(" "),
);
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);
const isAsciiLetter = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isTagNameChar = (c: string): boolean => isAsciiLetter(c) || (c >= "0" && c <= "9") || c === "-";
const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
const AUTOLINK_RE = /<(?:https?:\/\/|mailto:)[^\s<>]{1,500}>/iy;

export const stripHtml = (text: string): string => {
  const n = text.length;
  const lower = text.toLowerCase();
  let gt = text.indexOf(">");
  const nextGt = (from: number): number => {
    if (gt !== -1 && gt < from) gt = text.indexOf(">", from);
    return gt;
  };
  /** Exclusive end of a complete tag starting at i ("<" + name at j..k), or -1. */
  const tagEnd = (i: number, k: number): number => {
    const after = text[k] ?? "";
    if (!(after === ">" || after === "/" || isSpace(after))) return -1;
    const g = nextGt(k);
    return g !== -1 && g - i <= TAG_LOOKAHEAD ? g + 1 : -1;
  };
  const out: string[] = [];
  let last = 0;
  let i = text.indexOf("<");
  while (i !== -1) {
    let end = -1;
    if (text.startsWith("<!--", i)) {
      const close = text.indexOf("-->", i + 4);
      end = close === -1 ? n : close + 3;
    } else {
      const closing = text[i + 1] === "/";
      const j = closing ? i + 2 : i + 1;
      AUTOLINK_RE.lastIndex = i;
      const autolink = closing ? null : AUTOLINK_RE.exec(text);
      if (autolink) {
        end = i + autolink[0].length;
      } else if (isAsciiLetter(text[j] ?? "")) {
        let k = j + 1;
        while (k < n && k - j < 20 && isTagNameChar(text[k])) k++;
        const name = lower.slice(j, k);
        if (HTML_ELEMENTS.has(name) && !isTagNameChar(text[k] ?? "")) {
          const open = tagEnd(i, k);
          if (open !== -1 && !closing && RAW_TEXT_ELEMENTS.has(name)) {
            const close = lower.indexOf(`</${name}`, open);
            if (close === -1) end = n;
            else {
              const g = nextGt(close);
              end = g !== -1 && g - close <= TAG_LOOKAHEAD ? g + 1 : close + 2 + name.length;
            }
          } else {
            end = open;
          }
        }
      } else if (!closing && (text[j] === "!" || text[j] === "?") && isAsciiLetter(text[j + 1] ?? "")) {
        const g = nextGt(j);
        end = g !== -1 && g - i <= TAG_LOOKAHEAD ? g + 1 : -1;
      }
    }
    if (end === -1) {
      i = text.indexOf("<", i + 1);
      continue;
    }
    out.push(text.slice(last, i));
    last = end;
    i = end >= n ? -1 : text.indexOf("<", end);
  }
  out.push(text.slice(last));
  return out.join("");
};

/**
 * Strips HTML (incl. script/style contents), images, link URLs and emphasis markers. Keeps text, headings, lists,
 * tables, and every "<" that is not real markup. Linear: no pattern can rescan the rest of the input per position
 * (bracket/paren classes stop at the next bracket, line-anchored patterns never cross a newline).
 */
export const sanitizeText = (text: string): string => {
  let out = stripHtml(text);
  out = out.replace(/!\[[^\][\n]*\]\([^()[\]\n]*\)/g, ""); // inline images
  out = out.replace(/!\[[^\][\n]*\]\[[^\][\n]*\]/g, ""); // reference images
  out = out.replace(/\[([^\][\n]*)\]\([^()[\]\n]*\)/g, "$1"); // links: keep text
  out = out.replace(/\[([^\][\n]*)\]\[[^\][\n]*\]/g, "$1");
  out = out.replace(/^[ \t]*\[[^\][\n]+\]:[ \t]*\S.*$/gm, ""); // reference definitions
  out = out.replace(/\bhttps?:\/\/\S+/gi, ""); // raw links
  out = out.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/~~(.+?)~~/g, "$1");
  out = out.replace(/(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g, "$1");
  return out
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
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

/**
 * Final review S2/S4. Matching runs on a NORMALISED copy: NFKC per character, format / default-ignorable characters
 * removed (a zero-width space inside "ignore"), every whitespace run (incl. newlines) collapsed to one space ("previous"
 * and "instructions" on two lines). Each match maps back to the ORIGINAL text: `line` is the 1-based line of the match
 * start (unit "line", markdown) or the 1-based sentence/line segment within the text (unit "sentence", one PDF page,
 * which is usually a single line); the excerpt (<= 80 chars) is cut from the original text, centered on the match.
 * One flag per pattern per unit. Linear in the input.
 */
const HIDDEN_CHAR_RE = /^[\p{Cf}\p{Default_Ignorable_Code_Point}]$/u;
const EXCERPT_MAX = 80;

export const scanForInjection = (text: string, unit: "line" | "sentence" = "line"): InjectionFlag[] => {
  const norm: string[] = [];
  const map: number[] = []; // map[k] = index in `text` of the char that produced norm[k] (UTF-16 units)
  const boundaries: number[] = []; // original indexes where a new unit starts
  let prevSpace = true;
  let pos = 0;
  for (const ch of text) {
    const at = pos;
    pos += ch.length;
    if (ch === "\n") boundaries.push(at + 1);
    else if (unit === "sentence" && (ch === "." || ch === "!" || ch === "?") && /\s/.test(text[pos] ?? "")) boundaries.push(pos);
    if (/\s/.test(ch)) {
      if (!prevSpace) {
        norm.push(" ");
        map.push(at);
        prevSpace = true;
      }
      continue;
    }
    if (HIDDEN_CHAR_RE.test(ch)) continue;
    for (const c of ch.normalize("NFKC")) {
      norm.push(c);
      map.push(at);
    }
    prevSpace = false;
  }
  const flat = norm.join("");
  // norm[] holds code points; the regexes index UTF-16 units: build the unit -> original index map
  const unitMap: number[] = [];
  norm.forEach((c, k) => {
    for (let u = 0; u < c.length; u++) unitMap.push(map[k]);
  });
  const unitOf = (index: number): number => {
    let lo = 0;
    let hi = boundaries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (boundaries[mid] <= index) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
  const excerptAt = (start: number, end: number): string => {
    const center = Math.floor((start + end) / 2);
    let from = Math.max(0, center - EXCERPT_MAX / 2);
    const to = Math.min(text.length, from + EXCERPT_MAX);
    from = Math.max(0, to - EXCERPT_MAX);
    return text.slice(from, to).replace(/\s+/g, " ").trim().slice(0, EXCERPT_MAX);
  };
  const flags: InjectionFlag[] = [];
  const seen = new Set<string>();
  for (const { id, re } of INJECTION_PATTERNS) {
    const g = new RegExp(re.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = g.exec(flat)) !== null) {
      if (m[0].length === 0) {
        g.lastIndex++;
        continue;
      }
      const start = unitMap[m.index];
      const end = unitMap[m.index + m[0].length - 1] + 1;
      const line = unitOf(start);
      const key = `${id}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      flags.push({ id, line, excerpt: excerptAt(start, end) });
    }
  }
  return flags.sort((a, b) => a.line - b.line || INJECTION_PATTERNS.findIndex((p) => p.id === a.id) - INJECTION_PATTERNS.findIndex((p) => p.id === b.id));
};

export const flagKey = (flag: { id: string; line: number }): string => `${flag.id}:${flag.line}`;
