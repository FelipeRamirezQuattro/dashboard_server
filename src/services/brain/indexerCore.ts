import { EmbeddingProvider, embedInBatches } from "./embeddingProvider";
import { buildRecordCards } from "./recordCards";
import { DatasetDefinition } from "./types";

export const WRITE_BATCH_SIZE = 500;

/** Chunk embedding text: heading + newline + content (heading omitted when empty). */
export const buildChunkEmbeddingText = (heading: string | undefined | null, content: string): string =>
  heading && heading.trim() ? `${heading}\n${content}` : content;

/** True when the item has no usable embedding or it was made by a different model/version. */
export const needsReembedding = (
  item: { embeddingModel?: string; embeddingVersion?: string; embedding?: unknown },
  provider: { model: string; version: string },
): boolean => {
  if (!Array.isArray(item.embedding) || item.embedding.length === 0) return true;
  return item.embeddingModel !== provider.model || item.embeddingVersion !== provider.version;
};

/** The caller's filter: only active records feed card rebuilds. */
export const selectActiveRecords = <T extends { status: string }>(records: T[]): T[] =>
  records.filter((r) => r.status === "active");

/**
 * Rebuilds root cards from a dataset's records. TRUSTS its input: the caller must
 * pass only `status: "active"` records (use selectActiveRecords).
 */
export const rebuildCardsFromActiveRecords = (
  def: DatasetDefinition,
  activeRecords: { table: string; data: Record<string, unknown> }[],
): { primaryKeyValue: string; text: string }[] => {
  const rows: Record<string, Record<string, unknown>[]> = {};
  for (const r of activeRecords) (rows[r.table] ??= []).push(r.data);
  return buildRecordCards(def, rows).map((c) => ({ primaryKeyValue: c.primaryKeyValue, text: c.text }));
};

/** In-memory guard: one concurrent job per key. */
export const createJobGuard = () => {
  const running = new Set<string>();
  return {
    tryAcquire(key: string): boolean {
      if (running.has(key)) return false;
      running.add(key);
      return true;
    },
    release(key: string): void {
      running.delete(key);
    },
  };
};

export interface EmbeddingJobItem {
  id: string;
  text: string;
  current?: { embeddingModel?: string; embeddingVersion?: string; embedding?: unknown };
}
export interface EmbeddingWrite {
  id: string;
  embedding: number[];
  embeddingModel: string;
  embeddingVersion: string;
}

/** Pure job over injected ports. Never throws; never touches the DB. */
export const runEmbeddingJob = async (args: {
  items: EmbeddingJobItem[];
  provider: EmbeddingProvider | null;
  write: (writes: EmbeddingWrite[]) => Promise<void>;
  force?: boolean;
}): Promise<{ status: "done" | "failed"; embedded: number; errorName?: string }> => {
  const { provider } = args;
  if (!provider) return { status: "failed", embedded: 0, errorName: "NoProvider" };
  try {
    const todo = args.items.filter((i) => args.force || !i.current || needsReembedding(i.current, provider));
    if (!todo.length) return { status: "done", embedded: 0 };
    const vectors = await embedInBatches(provider, todo.map((i) => i.text));
    const writes: EmbeddingWrite[] = todo.map((i, n) => ({
      id: i.id,
      embedding: vectors[n],
      embeddingModel: provider.model,
      embeddingVersion: provider.version,
    }));
    for (let i = 0; i < writes.length; i += WRITE_BATCH_SIZE) {
      await args.write(writes.slice(i, i + WRITE_BATCH_SIZE));
    }
    return { status: "done", embedded: writes.length };
  } catch (e) {
    return { status: "failed", embedded: 0, errorName: e instanceof Error ? e.name : "Error" };
  }
};
