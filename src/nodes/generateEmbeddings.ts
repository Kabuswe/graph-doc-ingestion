/**
 * generateEmbeddings — embeds all chunks using local @xenova/transformers.
 */
import { embedTexts } from "../embeddings.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const generateEmbeddingsNode = async (state: any) => {
  const { chunks } = state;
  const chunkArray = Array.isArray(chunks) ? chunks as string[] : [];

  if (chunkArray.length === 0) {
    return { phase: "generate-embeddings", embeddedChunks: [] };
  }

  // Truncate each chunk to 512 chars to keep within model token limits
  const truncated = chunkArray.map(c => (c as string).slice(0, 512));
  const embeddings = await embedTexts(truncated);

  console.log(`[generateEmbeddings] Embedded ${embeddings.length} chunks`);

  return {
    phase: "generate-embeddings",
    embeddedChunks: embeddings,
  };
};
