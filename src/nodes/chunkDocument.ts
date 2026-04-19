/**
 * chunkDocument — splits raw text into overlapping chunks for embedding.
 * Strategies: fixed (char-based), sentence (sentence-boundary), semantic (paragraph-based).
 */

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE ?? "512", 10);
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP ?? "64", 10);

function chunkFixed(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += size - overlap;
  }
  return chunks.filter(c => c.trim().length > 20);
}

function chunkBySentence(text: string, targetSize: number): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  for (const s of sentences) {
    if ((current + s).length > targetSize && current.length > 0) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += " " + s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 20);
}

function chunkBySemantic(text: string, targetSize: number): string[] {
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let current = "";

  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > targetSize && current.length > 0) {
      chunks.push(current.trim());
      current = p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 20);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const chunkDocumentNode = async (state: any) => {
  const { rawText, chunkingStrategy = "sentence" } = state;
  const text = rawText as string ?? "";

  if (!text.trim()) {
    return { phase: "chunk-document", chunks: [] };
  }

  let chunks: string[];

  if (chunkingStrategy === "fixed") {
    chunks = chunkFixed(text, CHUNK_SIZE, CHUNK_OVERLAP);
  } else if (chunkingStrategy === "semantic") {
    chunks = chunkBySemantic(text, CHUNK_SIZE * 2);
  } else {
    // default: sentence
    chunks = chunkBySentence(text, CHUNK_SIZE);
  }

  console.log(`[chunkDocument] strategy=${chunkingStrategy}, produced ${chunks.length} chunks`);

  return {
    phase: "chunk-document",
    chunks,
    chunkCount: chunks.length,
  };
};
