/**
 * registerDynamoDB — registers ingested document in the document registry.
 * In production: writes to DynamoDB. Fallback: JSON file registry.
 */
import fs from "fs";

const REGISTRY_PATH = process.env.REGISTRY_PATH ?? "./doc-registry.json";

interface DocRegistryEntry {
  docId: string;
  clientId: string;
  docType: string;
  chunkCount: number;
  vectorIds: string[];
  registeredAt: string;
  metadata: Record<string, unknown>;
}

function loadRegistry(): DocRegistryEntry[] {
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8")) as DocRegistryEntry[];
    }
  } catch { /* ignore */ }
  return [];
}

function saveRegistry(entries: DocRegistryEntry[]): void {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const registerDynamoDBNode = async (state: any) => {
  const { vectorIds, chunkCount, clientId, docType, metadata } = state;

  const docId = crypto.randomUUID();

  const entry: DocRegistryEntry = {
    docId,
    clientId: clientId ?? "default",
    docType: docType ?? "unknown",
    chunkCount: chunkCount ?? (Array.isArray(vectorIds) ? (vectorIds as string[]).length : 0),
    vectorIds: Array.isArray(vectorIds) ? vectorIds as string[] : [],
    registeredAt: new Date().toISOString(),
    metadata: metadata ?? {},
  };

  // Try DynamoDB if configured
  const dynamoEndpoint = process.env.DYNAMODB_ENDPOINT_URL;
  if (dynamoEndpoint) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = await import("@aws-sdk/client-dynamodb") as any;
      const client = new mod.DynamoDBClient({ endpoint: dynamoEndpoint });
      await client.send(new mod.PutItemCommand({
        TableName: process.env.DYNAMODB_TABLE ?? "doc-registry",
        Item: {
          docId: { S: entry.docId },
          clientId: { S: entry.clientId },
          chunkCount: { N: String(entry.chunkCount) },
          registeredAt: { S: entry.registeredAt },
        },
      }));
    } catch (err) {
      console.warn("[registerDynamoDB] DynamoDB write failed, falling back to file:", (err as Error).message);
    }
  }

  // Always write to file registry as well
  const registry = loadRegistry();
  registry.push(entry);
  saveRegistry(registry);

  console.log(`[registerDynamoDB] Registered docId=${docId}, ${entry.chunkCount} chunks`);

  return {
    phase: "register-dynamodb",
    docId,
  };
};
