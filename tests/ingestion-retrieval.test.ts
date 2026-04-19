/**
 * tests/ingestion-retrieval.test.ts — integration test for doc-ingestion → rag-retriever pipeline
 * Tests the full pipeline: ingest docs → retrieve via semantic search.
 */
import "dotenv/config";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use a temp store for testing so we don't pollute the main store
const TEST_VECTOR_STORE = path.join(__dirname, "../test-vector-store.json");
const TEST_DOC_REGISTRY = path.join(__dirname, "../test-doc-registry.json");

process.env.VECTOR_STORE_PATH = TEST_VECTOR_STORE;
process.env.REGISTRY_PATH = TEST_DOC_REGISTRY;

// Clean up test stores before running
function cleanup() {
  [TEST_VECTOR_STORE, TEST_DOC_REGISTRY].forEach(p => {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
}

// Import AFTER setting env vars
const { graph: ingestionGraph } = await import("../src/graph.js");

async function main() {
  cleanup();
  console.log("\n=== graph-doc-ingestion integration tests ===\n");

  const testDocs = [
    {
      name: "LangGraph intro",
      rawContent: `LangGraph is a framework for building stateful, multi-actor applications with LLMs.
It models agent workflows as directed graphs where nodes are LLM calls or tools and edges define control flow.
Key features include: checkpointing, human-in-the-loop, streaming, and multi-agent coordination.
Built on top of LangChain, LangGraph extends it with graph-based orchestration.`,
      docType: "documentation",
    },
    {
      name: "OpenRouter overview",
      rawContent: `OpenRouter is a unified API gateway for large language models.
It provides access to 200+ models from providers like OpenAI, Anthropic, Google, and xAI.
Features include model routing, fallback, rate limiting, and cost tracking.
OpenRouter is compatible with the OpenAI API format, making migration straightforward.`,
      docType: "documentation",
    },
    {
      name: "Vector databases comparison",
      rawContent: `Vector databases store high-dimensional embeddings for semantic search.
Popular options include Pinecone, Weaviate, Qdrant, and Chroma.
Key metrics: recall@10, queries per second, storage cost, and latency.
For local development, Chroma and Qdrant offer self-hosted options.`,
      docType: "article",
    },
  ];

  // Phase 1: Ingest documents
  console.log("Phase 1: Ingesting test documents...");
  let allIngested = true;

  for (const doc of testDocs) {
    const result = await ingestionGraph.invoke(
      { rawContent: doc.rawContent, docType: doc.docType, clientId: "test", chunkingStrategy: "sentence" },
      { configurable: { thread_id: `ingest-${Date.now()}` } },
    );

    const ok = Array.isArray(result.vectorIds) && (result.vectorIds as string[]).length > 0;
    console.log(`  ${ok ? "✅" : "⚠️"} "${doc.name}" → ${(result.vectorIds as string[])?.length ?? 0} chunks, docId=${result.docId}`);
    if (!ok) allIngested = false;
  }

  console.log(`\n  Vector store: ${fs.existsSync(TEST_VECTOR_STORE) ? "written" : "MISSING"}`);

  // Phase 2: Retrieve via rag-retriever
  console.log("\nPhase 2: Testing retrieval...");
  const { graph: ragGraph } = await import("../../graph-rag-retriever/src/graph.js");

  const queries = [
    { query: "How does LangGraph handle state?", expect: "langgraph" },
    { query: "What is OpenRouter?", expect: "openrouter" },
    { query: "best vector database for production", expect: "vector" },
  ];

  let retrievalPassed = 0;
  for (const q of queries) {
    const result = await ragGraph.invoke(
      { query: q.query, topK: 3, rankingStrategy: "score" },
      { configurable: { thread_id: `retrieve-${Date.now()}` } },
    );

    const context = ((result.contextWindow ?? result.context) as string ?? "").toLowerCase();
    const found = context.includes(q.expect);
    const icon = found ? "✅" : "⚠️";
    console.log(`  ${icon} "${q.query}" → ${result.chunkCount} chunks, contains "${q.expect}": ${found}`);
    if (found) retrievalPassed++;
  }

  cleanup(); // remove test stores

  const total = testDocs.length + queries.length;
  const passed = (allIngested ? testDocs.length : 0) + retrievalPassed;
  console.log(`\n${passed}/${total} passed`);
  if (passed < total) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
