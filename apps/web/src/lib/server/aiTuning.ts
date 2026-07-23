import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

export type AiTuningProfile = {
  averageLatencyMs: number;
  maxRetries: number;
  model: string;
  passedVectors: number;
  provider: "deepseek";
  score: number;
  temperature: number;
  timeoutMs: number;
  totalVectors: number;
  tunedAt: string;
};

type TuningMeasurement = {
  latenciesMs: number[];
  model: string;
  passedVectors: number;
  totalVectors: number;
};

const fileName = "ai-tuning-profiles.json";

export function recommendAiTuningProfile(measurement: TuningMeasurement, now = new Date()): AiTuningProfile {
  const totalVectors = Math.max(1, Math.floor(measurement.totalVectors));
  const passedVectors = Math.max(0, Math.min(totalVectors, Math.floor(measurement.passedVectors)));
  const validLatencies = measurement.latenciesMs.filter((value) => Number.isFinite(value) && value >= 0);
  const averageLatencyMs = validLatencies.length
    ? Math.round(validLatencies.reduce((sum, value) => sum + value, 0) / validLatencies.length)
    : 0;
  const slowestLatencyMs = validLatencies.length ? Math.max(...validLatencies) : 6000;
  const score = Math.round((passedVectors / totalVectors) * 100);
  const timeoutMs = clamp(Math.ceil((slowestLatencyMs * 2 + 1000) / 500) * 500, 4000, 12000);

  return {
    averageLatencyMs,
    maxRetries: passedVectors === totalVectors ? 1 : 2,
    model: measurement.model,
    passedVectors,
    provider: "deepseek",
    score,
    temperature: score === 100 ? 0.15 : score >= 67 ? 0.08 : 0,
    timeoutMs,
    totalVectors,
    tunedAt: now.toISOString()
  };
}

export async function readAiTuningProfile(dataDir = "data", provider = "deepseek") {
  try {
    const parsed = JSON.parse(await readFile(`${dataDir}/${fileName}`, "utf8")) as { profiles?: AiTuningProfile[] };
    return (parsed.profiles || []).find((profile) => profile.provider === provider) || null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export function readAiTuningProfileSync(dataDir = "data", provider = "deepseek") {
  try {
    const parsed = JSON.parse(readFileSync(`${dataDir}/${fileName}`, "utf8")) as { profiles?: AiTuningProfile[] };
    return (parsed.profiles || []).find((profile) => profile.provider === provider) || null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    return null;
  }
}

export async function writeAiTuningProfile(profile: AiTuningProfile, dataDir = "data") {
  let profiles: AiTuningProfile[] = [];
  try {
    const parsed = JSON.parse(await readFile(`${dataDir}/${fileName}`, "utf8")) as { profiles?: AiTuningProfile[] };
    profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await mkdir(dataDir, { recursive: true });
  await writeFile(`${dataDir}/${fileName}`, `${JSON.stringify({ profiles: [...profiles.filter((item) => item.provider !== profile.provider), profile] }, null, 2)}\n`, "utf8");
  return profile;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
