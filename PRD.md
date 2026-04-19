# graph-doc-ingestion — Product Requirements Document

## Purpose
No-LLM document processing pipeline. Takes a document (by S3 key or raw content), extracts text, chunks it intelligently, generates embeddings, writes vectors to Amazon S3 Vectors, and registers the document in DynamoDB. This is the write side of the RAG system — `graph-rag-retriever` is the read side. Triggered by S3 Lambda events or called directly for on-demand ingestion.

## Deployment
- Deployed on LangSmith Deployment as `docIngestion`
- Also deployable as an AWS Lambda function triggered by S3 `ObjectCreated` events
- `langgraph.json`: `{ "graphs": { "docIngestion": "./src/graph.ts:graph" } }`

## Pipeline
```
START → extractText → detectStructure → chunkDocument → generateEmbeddings → writeS3Vectors → registerDynamoDB → END
```

### Node Responsibilities

**`extractText`**
- Detect format from MIME type or extension: PDF, DOCX, MD, TXT, HTML
- Extract plain text using: `pdf-parse` (PDF), `mammoth` (DOCX), `unified` (MD), `cheerio` (HTML)
- Output: `rawText: string`, `detectedFormat: string`, `pageCount?: number`

**`detectStructure`**
- Identify document structure: has headings, has tables, has code blocks, has lists
- Determine chunking strategy: `semantic` (has headings) | `fixed` (plain prose) | `sentence` (short docs)
- Output: `structureProfile`, `chunkingStrategy`

**`chunkDocument`**
- Apply chunking strategy with overlap (default: 512 tokens, 64 token overlap)
- Preserve heading context in each chunk metadata
- Assign `chunkIndex` and `chunkId` (deterministic: `${docId}-${chunkIndex}`)
- Output: `chunks: Array<{ chunkId, content, metadata }>`

**`generateEmbeddings`**
- Batch embed all chunks: Bedrock Titan Embeddings V2 (cloud) or Ollama `nomic-embed-text` (local)
- Rate-limit aware: batch size 25, exponential backoff on throttle
- Output: `embeddedChunks: VectorChunk[]` (chunks with `embedding` field populated)

**`writeS3Vectors`**
- `PutVectors` to S3 Vectors index in batches of 500
- Each vector metadata: `{ source, clientId, docType, docId, chunkIndex, date, tags[], pageNumber? }`
- Output: `vectorIds: string[]`, `vectorCount: number`

**`registerDynamoDB`**
- Write document registry entry: `{ docId, clientId, s3Key, format, chunkCount, vectorIds[], status: 'indexed', indexedAt }`
- Update status from `processing` → `indexed`
- Output: `registryEntry`, `status: 'indexed'`

## State Schema
```ts
{
  s3Key?: string;
  rawContent?: string;
  clientId: string;
  docType: string;
  metadata: Record<string, string>;
  mode: 'cloud' | 'local';

  rawText: string;
  detectedFormat: string;
  pageCount?: number;
  structureProfile: object;
  chunkingStrategy: 'semantic' | 'fixed' | 'sentence';
  chunks: Array<{ chunkId: string; content: string; metadata: object }>;
  embeddedChunks: VectorChunk[];
  vectorIds: string[];
  vectorCount: number;
  registryEntry: object;
  status: string;

  error?: string;
  phase: string;
}
```

## Key Design Constraints
- Zero LLM calls — this graph must be deterministic and cheap to run at scale
- Idempotent: re-running on the same `docId` must overwrite, not duplicate
- `chunkId` must be deterministic for deduplication: `sha256(docId + chunkIndex)`
- Max document size: 50MB; reject and log to DynamoDB with `status: 'rejected'` if exceeded

## Environment Variables
```
VECTOR_STORE_MODE=s3
S3_VECTORS_INDEX_ARN=
DYNAMODB_REGISTRY_TABLE=kabatoshi-doc-registry
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
OLLAMA_BASE_URL=http://localhost:11434
SQLITE_DB_PATH=
LANGSMITH_API_KEY=
LANGSMITH_TRACING_V2=true
DATABASE_URL=
```

## Agent Instructions
1. No LangChain model calls — this is a pure data pipeline
2. `generateEmbeddings` is the only async-heavy node; implement proper batching with `Promise.allSettled`
3. `writeS3Vectors` must handle partial failures: log failed vector IDs, continue, report in output
4. The `chunkId` must be a deterministic hash — use Node.js `crypto.createHash('sha256')`
5. Add a Lambda adapter entry point `src/lambda.ts` that wraps `buildGraph().invoke()` for S3 event triggers
6. Write unit tests for each chunking strategy with sample documents
7. Test idempotency: invoking twice with same `docId` must result in identical DynamoDB record

## Acceptance Criteria
- A 10-page PDF is ingested, chunked into ~40 chunks, embedded, and written to S3 Vectors in < 30 seconds
- Re-running with the same `s3Key` results in identical `vectorIds` (idempotent)
- DynamoDB registry shows `status: 'indexed'` with correct `chunkCount`
- Local mode works end-to-end with Ollama embeddings and SQLite-vec
