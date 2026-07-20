import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import type { AssistantRouteContract } from "../assistantRouter";

type CachedAssistantRouteRow = {
  created_at: string;
  family_context_hash: string;
  input_hash: string;
  model_name: string;
  prompt_version: string;
  route_result: AssistantRouteContract;
};

const defaultDataDir = "data";
const cacheFileName = "assistant-route-cache.jsonl";

export async function readCachedAssistantRoute(input: {
  dataDir?: string;
  familyContextHash: string;
  inputText: string;
  modelName: string;
  promptVersion: string;
}) {
  const inputHash = hashText(input.inputText);
  const rows = await readJsonl(`${input.dataDir || defaultDataDir}/${cacheFileName}`);
  const cached = rows
    .reverse()
    .find(
      (row) =>
        row.input_hash === inputHash &&
        row.family_context_hash === input.familyContextHash &&
        row.model_name === input.modelName &&
        row.prompt_version === input.promptVersion
    );
  return cached?.route_result || null;
}

export async function writeCachedAssistantRoute(input: {
  dataDir?: string;
  familyContextHash: string;
  inputText: string;
  modelName: string;
  promptVersion: string;
  route: AssistantRouteContract;
}) {
  const dataDir = input.dataDir || defaultDataDir;
  await mkdir(dataDir, { recursive: true });
  const row: CachedAssistantRouteRow = {
    created_at: new Date().toISOString(),
    family_context_hash: input.familyContextHash,
    input_hash: hashText(input.inputText),
    model_name: input.modelName,
    prompt_version: input.promptVersion,
    route_result: input.route
  };
  await appendFile(`${dataDir}/${cacheFileName}`, `${JSON.stringify(row)}\n`, "utf8");
}

export function hashFamilyContext(value: unknown) {
  return hashText(JSON.stringify(value));
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJsonl(filePath: string): Promise<CachedAssistantRouteRow[]> {
  try {
    const content = await readFile(filePath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown)
      .filter((row): row is CachedAssistantRouteRow => Boolean(row && typeof row === "object" && !Array.isArray(row)));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
