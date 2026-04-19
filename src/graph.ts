/**
 * graph-doc-ingestion
 *
 * Pipeline: extractText → detectStructure → chunkDocument → generateEmbeddings → writeS3Vectors → registerDynamoDB
 *
 * Input:  DocIngestionInput  (s3Key|rawContent, clientId, docType, metadata)
 * Output: DocIngestionOutput (vectorIds[], vectorCount, registryEntry, status)
 *
 * ZERO LLM CALLS — pure deterministic processing pipeline.
 * Implementation tracked in GitHub issues — see repo Issues tab.
 */

import { StateGraph, START, END, MemorySaver, StateSchema, UntrackedValue } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import pg from 'pg';
import { z } from 'zod';

function lastValue<T>(schema: z.ZodType<T, any, any>): UntrackedValue<T> {
  return schema as unknown as UntrackedValue<T>;
}

const IngestionState = new StateSchema({
  s3Key:             lastValue(z.string().optional()),
  rawContent:        lastValue(z.string().optional()),
  clientId:          lastValue(z.string().default('')),
  docType:           lastValue(z.string().default('')),
  metadata:          lastValue(z.record(z.string()).default(() => ({}))),
  mode:              lastValue(z.enum(['cloud', 'local']).default('cloud')),
  rawText:           lastValue(z.string().default('')),
  detectedFormat:    lastValue(z.string().default('')),
  pageCount:         lastValue(z.number().optional()),
  structureProfile:  lastValue(z.any().default(() => ({}))),
  chunkingStrategy:  lastValue(z.enum(['semantic', 'fixed', 'sentence']).default('fixed')),
  chunks:            lastValue(z.array(z.any()).default(() => [])),
  embeddedChunks:    lastValue(z.array(z.any()).default(() => [])),
  vectorIds:         lastValue(z.array(z.string()).default(() => [])),
  vectorCount:       lastValue(z.number().default(0)),
  registryEntry:     lastValue(z.any().optional()),
  status:            lastValue(z.string().default('processing')),
  error:             lastValue(z.string().optional()),
  phase:             lastValue(z.string().default('')),
});

const standardRetry = { maxAttempts: 3, initialInterval: 1000, backoffFactor: 2 };

import { extractTextNode }        from './nodes/extractText.js';
import { detectStructureNode }    from './nodes/detectStructure.js';
import { chunkDocumentNode }      from './nodes/chunkDocument.js';
import { generateEmbeddingsNode } from './nodes/generateEmbeddings.js';
import { writeS3VectorsNode }     from './nodes/writeS3Vectors.js';
import { registerDynamoDBNode }   from './nodes/registerDynamoDB.js';

function assembleGraph(checkpointer?: MemorySaver) {
  const builder = new StateGraph(IngestionState)
    .addNode('extractText',        extractTextNode,        { retryPolicy: standardRetry })
    .addNode('detectStructure',    detectStructureNode,    { retryPolicy: standardRetry })
    .addNode('chunkDocument',      chunkDocumentNode,      { retryPolicy: standardRetry })
    .addNode('generateEmbeddings', generateEmbeddingsNode, { retryPolicy: standardRetry })
    .addNode('writeS3Vectors',     writeS3VectorsNode,     { retryPolicy: standardRetry })
    .addNode('registerDynamoDB',   registerDynamoDBNode,   { retryPolicy: standardRetry })
    .addEdge(START, 'extractText')
    .addEdge('extractText', 'detectStructure')
    .addEdge('detectStructure', 'chunkDocument')
    .addEdge('chunkDocument', 'generateEmbeddings')
    .addEdge('generateEmbeddings', 'writeS3Vectors')
    .addEdge('writeS3Vectors', 'registerDynamoDB')
    .addEdge('registerDynamoDB', END);

  return checkpointer ? builder.compile({ checkpointer }) : builder.compile();
}

export const graph: any = assembleGraph(new MemorySaver());

export async function buildGraph(): Promise<any> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const checkpointer = new PostgresSaver(pool);
  await checkpointer.setup();
  return assembleGraph(checkpointer as unknown as MemorySaver);
}
