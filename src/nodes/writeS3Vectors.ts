/**
 * writeS3Vectors — persists chunk embeddings to the file-based vector store.
 * In production: writes to AWS S3 Vectors or an alternative vector DB.
 */
import { appendToStore } from "../vectorStore.js";
import type { VectorRecord } from "../vectorStore.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const writeS3VectorsNode = async (state: any) => {
  const { chunks, embeddedChunks, clientId, docType, metadata } = state;

  const chunkArray = Array.isArray(chunks) ? chunks as string[] : [];
  const embeddingArray = Array.isArray(embeddedChunks) ? embeddedChunks as number[][] : [];

  if (chunkArray.length === 0 || embeddingArray.length !== chunkArray.length) {
    console.warn("[writeS3Vectors] Chunk/embedding mismatch or empty arrays");
    return { phase: "write-s3-vectors", vectorIds: [] };
  }

  const vectorIds: string[] = [];
  const records: VectorRecord[] = chunkArray.map((text, idx) => {
    const id = crypto.randomUUID();
    vectorIds.push(id);
    return {
      id,
      text,
      embedding: embeddingArray[idx],
      metadata: {
        clientId: clientId ?? "default",
        docType: docType ?? "unknown",
        chunkIndex: idx,
        ingestedAt: new Date().toISOString(),
        ...(metadata ?? {}),
      },
    };
  });

  appendToStore(records);
  console.log(`[writeS3Vectors] Wrote ${records.length} vectors to store`);

  return {
    phase: "write-s3-vectors",
    vectorIds,
  };
};
