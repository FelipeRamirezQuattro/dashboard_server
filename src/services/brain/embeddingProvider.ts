import OpenAI from "openai";
import { env } from "../../config/env";

export interface EmbeddingProvider {
  model: string;
  version: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Generic by design: never carries input text or the provider's raw message. */
export class EmbeddingError extends Error {
  constructor(message = "Embedding request failed") {
    super(message);
    this.name = "EmbeddingError";
  }
}

export const MAX_EMBEDDING_INPUT_CHARS = 8000;

export const truncateForEmbedding = (text: string): string =>
  text.length > MAX_EMBEDDING_INPUT_CHARS ? text.slice(0, MAX_EMBEDDING_INPUT_CHARS) : text;

export const EMPTY_TEXT_PLACEHOLDER = "(empty)";

/** Truncates and replaces empty/whitespace-only texts so counts and order are preserved. */
export const prepareEmbeddingInputs = (texts: string[]): string[] =>
  texts.map((t) => (t.trim() === "" ? EMPTY_TEXT_PLACEHOLDER : truncateForEmbedding(t)));

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  model: string;
  version: string;
  private client: OpenAI;

  constructor(opts: { apiKey: string; model: string; version: string }) {
    this.model = opts.model;
    this.version = opts.version;
    this.client = new OpenAI({ apiKey: opts.apiKey, timeout: 60_000, maxRetries: 2 });
  }

  async embed(texts: string[]): Promise<number[][]> {
    try {
      const res = await this.client.embeddings.create({
        model: this.model,
        input: prepareEmbeddingInputs(texts),
      });
      const data = [...res.data].sort((a, b) => a.index - b.index);
      return data.map((d) => d.embedding);
    } catch {
      throw new EmbeddingError();
    }
  }
}

export const getEmbeddingProvider = (): EmbeddingProvider | null => {
  if (!env.openaiApiKey) return null;
  return new OpenAiEmbeddingProvider({
    apiKey: env.openaiApiKey,
    model: env.brainEmbeddingModel,
    version: env.brainEmbeddingVersion,
  });
};

const validVector = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** Splits into batches, preserves order, and verifies every returned vector. */
export const embedInBatches = async (
  provider: EmbeddingProvider,
  texts: string[],
  batchSize = 64,
): Promise<number[][]> => {
  const size = Math.max(1, Math.floor(batchSize));
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += size) {
    const batch = texts.slice(i, i + size);
    let vectors: number[][];
    try {
      vectors = await provider.embed(batch);
    } catch {
      throw new EmbeddingError();
    }
    if (!Array.isArray(vectors) || vectors.length !== batch.length) {
      throw new EmbeddingError("Embedding provider returned an unexpected number of vectors");
    }
    for (const v of vectors) {
      if (!validVector(v)) throw new EmbeddingError("Embedding provider returned an invalid vector");
    }
    out.push(...vectors);
  }
  return out;
};
