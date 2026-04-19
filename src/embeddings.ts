/**
 * embeddings.ts — local embeddings for graph-doc-ingestion.
 * Same implementation as graph-rag-retriever.
 */
let pipeline: ((texts: string[], options?: Record<string, unknown>) => Promise<unknown[]>) | null = null;

async function getEmbeddingPipeline() {
  if (pipeline) return pipeline;
  const { pipeline: p } = await import("@xenova/transformers") as {
    pipeline: (task: string, model: string) => Promise<(texts: string[], opts?: Record<string, unknown>) => Promise<unknown[]>>
  };
  pipeline = await p("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  return pipeline;
}

export async function embedText(text: string): Promise<number[]> {
  const pipe = await getEmbeddingPipeline();
  const out = await pipe([text], { pooling: "mean", normalize: true });
  const first = out[0] as { data: Float32Array } | Float32Array | number[];
  if ("data" in first) return Array.from((first as { data: Float32Array }).data);
  if (first instanceof Float32Array) return Array.from(first);
  return first as number[];
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map(embedText));
}
