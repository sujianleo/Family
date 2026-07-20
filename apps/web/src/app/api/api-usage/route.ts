import { NextResponse } from "next/server";
import {
  DEFAULT_USD_CNY_RATE,
  DEEPSEEK_PRICING_RETRIEVED_AT,
  DEEPSEEK_PRICING_SOURCE_URL,
  USD_CNY_EXCHANGE_RATE_RETRIEVED_AT,
  USD_CNY_EXCHANGE_RATE_SOURCE_URL,
  deepSeekPricingByModel,
  summarizeApiUsage
} from "@/lib/server/apiUsage";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireFamilyRequestContext(request);
    const usage = await summarizeApiUsage();
    return NextResponse.json({
      ok: true,
      pricing: {
        exchangeRateSourceUrl: USD_CNY_EXCHANGE_RATE_SOURCE_URL,
        exchangeRateRetrievedAt: USD_CNY_EXCHANGE_RATE_RETRIEVED_AT,
        models: deepSeekPricingByModel,
        pricingRetrievedAt: DEEPSEEK_PRICING_RETRIEVED_AT,
        pricingSourceUrl: DEEPSEEK_PRICING_SOURCE_URL,
        usdCnyRate: DEFAULT_USD_CNY_RATE
      },
      usage
    });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) {
      return NextResponse.json({ detail: error.message, ok: false }, { status: error.status });
    }
    return NextResponse.json(
      {
        detail: error instanceof Error ? error.message : "API 使用量统计读取失败。",
        ok: false
      },
      { status: 500 }
    );
  }
}
