import { NextResponse } from "next/server";
import { recommendAiTuningProfile, readAiTuningProfile, writeAiTuningProfile } from "@/lib/server/aiTuning";
import { requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { getFastModelName, invokeDeepSeekJson } from "@/lib/server/langchainAi";

export const runtime = "nodejs";

const testVectors = [
  {
    id: "schema",
    prompt: "只输出 JSON。计算 19 + 23，并严格返回 {\"answer\":42}。",
    validate: (value: unknown) => readRecord(value)?.answer === 42
  },
  {
    id: "extraction",
    prompt: "只输出 JSON。从‘明天提醒老妈做红烧肉’提取并严格返回 {\"person\":\"老妈\",\"task\":\"做红烧肉\"}。",
    validate: (value: unknown) => {
      const record = readRecord(value);
      return record?.person === "老妈" && record.task === "做红烧肉";
    }
  },
  {
    id: "instruction",
    prompt: "只输出 JSON。判断‘帮我记住爸爸不吃辣’是否需要用户确认，严格返回 {\"needsConfirmation\":true}。",
    validate: (value: unknown) => readRecord(value)?.needsConfirmation === true
  }
] as const;

export async function GET(request: Request) {
  try {
    await requireFamilyRequestContext(request);
    return NextResponse.json({ ok: true, profile: await readAiTuningProfile() });
  } catch (error) {
    return NextResponse.json({ detail: readError(error, "读取 AI 调参结果失败。"), ok: false }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = await request.json().catch(() => ({})) as {
      apiKey?: unknown;
      endpoint?: unknown;
      kind?: unknown;
      model?: unknown;
    };
    if (body.kind !== "deepseek") {
      return NextResponse.json({ detail: "当前调参器先支持 DeepSeek，其他服务商会在对应适配器接入后启用。", ok: false }, { status: 400 });
    }
    const endpoint = normalizeDeepSeekEndpoint(body.endpoint);
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : getFastModelName();
    const results = [] as Array<{ detail?: string; id: string; latencyMs: number; passed: boolean }>;

    for (const vector of testVectors) {
      const startedAt = Date.now();
      try {
        const value = await invokeDeepSeekJson(
          [["system", "你正在执行 API 能力校准。严格遵循输出格式，不要添加解释。"], ["human", vector.prompt]],
          {
            apiKey: apiKey || undefined,
            baseUrl: endpoint,
            familyId: context.familyId,
            maxTokens: 80,
            model,
            operation: `ai-tuning.${vector.id}`,
            temperature: 0,
            timeoutMs: 7000
          }
        );
        results.push({ id: vector.id, latencyMs: Date.now() - startedAt, passed: vector.validate(value) });
      } catch (error) {
        results.push({ detail: readError(error, "调用失败"), id: vector.id, latencyMs: Date.now() - startedAt, passed: false });
      }
    }

    const passedVectors = results.filter((result) => result.passed).length;
    if (passedVectors === 0) {
      return NextResponse.json({ detail: results.find((result) => result.detail)?.detail || "API 未通过测试向量，请检查 Key、模型和网络。", ok: false, results }, { status: 502 });
    }
    const profile = recommendAiTuningProfile({
      latenciesMs: results.map((result) => result.latencyMs),
      model,
      passedVectors,
      totalVectors: testVectors.length
    });
    await writeAiTuningProfile(profile);
    return NextResponse.json({ ok: true, profile, results });
  } catch (error) {
    return NextResponse.json({ detail: readError(error, "AI 调参失败。"), ok: false }, { status: 400 });
  }
}

function normalizeDeepSeekEndpoint(value: unknown) {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : "https://api.deepseek.com";
  const url = new URL(candidate);
  if (url.protocol !== "https:" || url.hostname !== "api.deepseek.com") {
    throw new Error("AI 调参仅允许连接 DeepSeek 官方 HTTPS 端点。");
  }
  return url.origin;
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
