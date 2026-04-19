/**
 * extractText — extracts plain text from raw content (base64, S3 URL, or inline).
 */

function decodeBase64(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf-8");
}

async function fetchFromUrl(url: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return r.text();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const extractTextNode = async (state: any) => {
  const { rawContent, s3Url } = state;

  let text = "";

  if (s3Url) {
    try {
      text = await fetchFromUrl(s3Url as string);
    } catch (err) {
      console.warn("[extractText] S3 fetch failed:", (err as Error).message);
    }
  }

  if (!text && rawContent) {
    const raw = rawContent as string;
    // Detect base64
    if (/^[A-Za-z0-9+/]+=*$/.test(raw.replace(/\s/g, "")) && raw.length > 100) {
      try { text = decodeBase64(raw); } catch { text = raw; }
    } else {
      text = raw;
    }
  }

  return {
    phase: "extract-text",
    rawText: text,
    charCount: text.length,
  };
};
