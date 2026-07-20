import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async () => {
  const appUrl = Deno.env.get("FAMILY_APP_URL");
  const secret = Deno.env.get("DECISION_CRON_SECRET");
  if (!appUrl || !secret) return new Response(JSON.stringify({ detail: "decision close function is not configured" }), { status: 503 });
  const response = await fetch(`${appUrl.replace(/\/$/, "")}/api/family-decisions/close-due`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
});
