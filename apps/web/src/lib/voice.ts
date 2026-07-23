import { familyFetch } from "./familyApi";

export async function enqueueVoiceNote(file: File, durationMs: number) {
  const form = new FormData();
  form.append("file", file);
  form.append("duration_ms", String(Math.max(0, Math.round(durationMs))));
  const res = await familyFetch("/api/voice-notes", {
    method: "POST",
    body: form
  });

  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw new Error(detail || `语音上传失败：HTTP ${res.status}`);
  }

  return (await res.json()) as { id: string | null; status: string; transcript: string };
}

async function readErrorDetail(res: Response) {
  const contentType = res.headers.get("content-type");

  if (contentType?.includes("application/json")) {
    const data = (await res.json()) as { detail?: unknown };
    return typeof data.detail === "string" ? data.detail : "";
  }

  return (await res.text()).slice(0, 160);
}
