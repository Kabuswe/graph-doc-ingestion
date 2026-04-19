/**
 * detectStructure — detects document structure and format.
 * Identical approach to graph-doc-processor/detectFormat but simplified for ingestion.
 */

type DocFormat = "json" | "html" | "markdown" | "csv" | "xml" | "yaml" | "plain";

function detectFormat(text: string): DocFormat {
  const s = text.trimStart();
  if (s.startsWith("{") || s.startsWith("[")) return "json";
  if (/<html/i.test(s) || /<!DOCTYPE/i.test(s)) return "html";
  if (s.startsWith("<") && /<\/\w+>/.test(s)) return "xml";
  if (/^---\n/.test(s) || /^#{1,6} /.test(s) || /\*\*[^*]+\*\*/.test(s)) return "markdown";
  if (/^[\w"' ]+,[\w"' ]+/.test(s.split("\n")[0])) return "csv";
  if (/^[a-z_]+:\s/.test(s)) return "yaml";
  return "plain";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const detectStructureNode = async (state: any) => {
  const { rawText } = state;
  const text = rawText as string ?? "";

  const format = detectFormat(text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const lineCount = text.split("\n").length;

  return {
    phase: "detect-structure",
    detectedFormat: format,
    wordCount,
    lineCount,
  };
};
