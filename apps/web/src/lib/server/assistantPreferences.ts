import { mkdir, readFile, writeFile } from "node:fs/promises";

export type AssistantPreference = {
  memberId: string;
  personality: string;
  updatedAt: string;
};

const fileName = "assistant-preferences.json";

export async function readAssistantPreference(dataDir: string, memberId: string): Promise<AssistantPreference | null> {
  try {
    const parsed = JSON.parse(await readFile(`${dataDir}/${fileName}`, "utf8")) as { members?: AssistantPreference[] };
    return (parsed.members || []).find((item) => item.memberId === memberId) || null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeAssistantPreference(dataDir: string, memberId: string, personality: string, now = new Date()) {
  const normalized = personality.trim().slice(0, 300);
  let members: AssistantPreference[] = [];
  try {
    const parsed = JSON.parse(await readFile(`${dataDir}/${fileName}`, "utf8")) as { members?: AssistantPreference[] };
    members = Array.isArray(parsed.members) ? parsed.members : [];
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const preference = { memberId, personality: normalized, updatedAt: now.toISOString() };
  await mkdir(dataDir, { recursive: true });
  await writeFile(`${dataDir}/${fileName}`, `${JSON.stringify({ members: [...members.filter((item) => item.memberId !== memberId), preference] }, null, 2)}\n`, "utf8");
  return preference;
}
