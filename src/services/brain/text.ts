const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "when",
  "where",
  "who",
  "whats",
  "whos",
  "whose",
  "why",
]);

export const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const tokensFor = (value: string): string[] =>
  normalize(value)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
