/**
 * vectorStore.ts — File-based vector store for doc-ingestion writes.
 * Reads/writes the same JSON store that rag-retriever reads from.
 */
import fs from "fs";

const STORE_PATH = process.env.VECTOR_STORE_PATH ?? "./vector-store.json";

export interface VectorRecord {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    clientId?: string;
    docType?: string;
    source?: string;
    chunkIndex?: number;
    ingestedAt?: string;
    [key: string]: unknown;
  };
}

export function loadStore(): VectorRecord[] {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8")) as VectorRecord[];
    }
  } catch { /* ignore */ }
  return [];
}

export function saveStore(records: VectorRecord[]): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(records, null, 2), "utf-8");
}

export function appendToStore(newRecords: VectorRecord[]): void {
  const existing = loadStore();
  const existing_ids = new Set(existing.map(r => r.id));
  const merged = [
    ...existing,
    ...newRecords.filter(r => !existing_ids.has(r.id)),
  ];
  saveStore(merged);
}
