import { buildLocalAvatarPng } from "@/lib/avatarSvg";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  const seed = decodeURIComponent(file).replace(/\.(png|svg)$/i, "").trim();

  if (!seed || !/^[\w.-]+$/.test(seed)) {
    return new Response("Invalid avatar seed", { status: 400 });
  }

  const variant = new URL(request.url).searchParams.get("variant") === "mono" ? "mono" : "color";
  return new Response(new Uint8Array(await buildLocalAvatarPng(seed, variant)), {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": "image/png"
    }
  });
}
