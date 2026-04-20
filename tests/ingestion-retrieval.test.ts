/**
 * tests/ingestion-retrieval.test.ts — vitest integration tests for graph-doc-ingestion.
 * Uses local @xenova/transformers embeddings (no API key required).
 * Phase 1: ingest test documents → verify vector store written.
 * Phase 2: cross-validate retrieval via graph-rag-retriever (sibling repo).
 */
import "dotenv/config";
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_VECTOR_STORE = path.join(__dirname, "../test-vector-store.json");
const TEST_DOC_REGISTRY = path.join(__dirname, "../test-doc-registry.json");

// Set env BEFORE importing graph so vectorStore.ts picks up the path
process.env.VECTOR_STORE_PATH = TEST_VECTOR_STORE;
process.env.REGISTRY_PATH    = TEST_DOC_REGISTRY;

const { graph: ingestionGraph } = await import("../src/graph.js");

beforeAll(() => {
  [TEST_VECTOR_STORE, TEST_DOC_REGISTRY].forEach(p => {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
});

afterAll(() => {
  [TEST_VECTOR_STORE, TEST_DOC_REGISTRY].forEach(p => {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
});

const TEST_DOCS = [
  {
    rawContent: `LangGraph is a framework for building stateful, multi-actor applications with LLMs.
It models agent workflows as directed graphs where nodes are LLM calls or tools and edges define control flow.
Key features include: checkpointing, human-in-the-loop, streaming, and multi-agent coordination.
Built on top of LangChain, LangGraph extends it with graph-based orchestration.`,
    docType: "documentation",
  },
  {
    rawContent: `OpenRouter is a unified API gateway for large language models.
It provides access to 200+ models from providers like OpenAI, Anthropic, Google, and xAI.
Features include model routing, fallback, rate limiting, and cost tracking.
OpenRouter is compatible with the OpenAI API format, making migration straightforward.`,
    docType: "documentation",
  },
  {
    rawContent: `Vector databases store high-dimensional embeddings for semantic search.
Popular options include Pinecone, Weaviate, Qdrant, and Chroma.
Key metrics: recall@10, queries per second, storage cost, and latency.
For local development, Chroma and Qdrant offer self-hosted options.`,
    docType: "article",
  },
];

describe("graph-doc-ingestion — Phase 1: ingest", () => {
  test("ingests plain text and produces vectorIds + docId", async () => {
    const result = await ingestionGraph.invoke(
      { rawContent: TEST_DOCS[0].rawContent, docType: TEST_DOCS[0].docType, clientId: "test", chunkingStrategy: "sentence" },
      { configurable: { thread_id: `ingest-${Date.now()}` } },
    );
    expect(Array.isArray(result.vectorIds)).toBe(true);
    expect((result.vectorIds as string[]).length).toBeGreaterThan(0);
    expect(typeof result.docId).toBe("string");
  }, 180000);

  test("ingests OpenRouter doc with sentence chunking", async () => {
    const result = await ingestionGraph.invoke(
      { rawContent: TEST_DOCS[1].rawContent, docType: TEST_DOCS[1].docType, clientId: "test", chunkingStrategy: "sentence" },
      { configurable: { thread_id: `ingest-${Date.now()}` } },
    );
    expect((result.vectorIds as string[]).length).toBeGreaterThan(0);
    expect(fs.existsSync(TEST_VECTOR_STORE)).toBe(true);
    expect(fs.existsSync(TEST_DOC_REGISTRY)).toBe(true);
  }, 60000);

  test("ingests markdown article with semantic chunking", async () => {
    const result = await ingestionGraph.invoke(
      { rawContent: TEST_DOCS[2].rawContent, docType: TEST_DOCS[2].docType, clientId: "test", chunkingStrategy: "semantic" },
      { configurable: { thread_id: `ingest-${Date.now()}` } },
    );
    expect((result.vectorIds as string[]).length).toBeGreaterThan(0);
  }, 60000);
});

describe("graph-doc-ingestion — Phase 2: cross-validate retrieval", () => {
  test("vector store is readable and contains seeded chunks", async () => {
    expect(fs.existsSync(TEST_VECTOR_STORE)).toBe(true);
    const store = JSON.parse(fs.readFileSync(TEST_VECTOR_STORE, "utf-8")) as unknown[];
    expect(store.length).toBeGreaterThan(0);
    const first = store[0] as Record<string, unknown>;
    expect(typeof first.id).toBe("string");
    expect(Array.isArray(first.embedding)).toBe(true);
    expect(typeof first.text).toBe("string");
  });

  test("rag-retriever finds relevant context from ingested docs", async () => {
    const { graph: ragGraph } = await import("../../graph-rag-retriever/src/graph.js");
    const result = await ragGraph.invoke(
      { query: "How does LangGraph handle state?", topK: 3, rankingStrategy: "score" },
      { configurable: { thread_id: `retrieve-${Date.now()}` } },
    );
    expect(result.chunkCount).toBeGreaterThan(0);
    const ctx = (result.contextWindow as string ?? "").toLowerCase();
    expect(ctx).toContain("langgraph");
  }, 60000);
});
