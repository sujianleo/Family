import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { Database } from "@/lib/types";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { transcribeAudioLocally } from "@/lib/server/localSpeechTranscription";
import { readSupabaseServerUrl } from "@/lib/server/supabaseConfig";

export const runtime = "nodejs";
const maxVoiceBytes = 25 * 1024 * 1024;

const openaiApiKey = process.env.OPENAI_API_KEY;
const transcribeModel = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const supabaseUrl = readSupabaseServerUrl();
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const voiceBucket = process.env.SUPABASE_VOICE_BUCKET || "voice-notes";

export async function GET(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const requestedPath = new URL(request.url).searchParams.get("path") || "";
    const objectPath = requestedPath.startsWith(`${voiceBucket}/`) ? requestedPath.slice(voiceBucket.length + 1) : requestedPath;
    if (!supabaseUrl || !supabaseServiceRoleKey || !context.familyId) {
      return NextResponse.json({ detail: "语音存储未配置。" }, { status: 503 });
    }
    if (!objectPath.startsWith(`${context.familyId}/`) || objectPath.includes("..")) {
      return NextResponse.json({ detail: "无权访问这条语音。" }, { status: 403 });
    }

    const supabase = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });
    const { data, error } = await supabase.storage.from(voiceBucket).download(objectPath);
    if (error || !data) {
      return NextResponse.json({ detail: error?.message || "语音不存在。" }, { status: 404 });
    }

    const bytes = new Uint8Array(await data.arrayBuffer());
    const range = readByteRange(request.headers.get("range"), bytes.byteLength);
    const payload = range ? bytes.slice(range.start, range.end + 1) : bytes;
    return new Response(payload, {
      status: range ? 206 : 200,
      headers: {
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=300",
        "content-length": String(payload.byteLength),
        "content-type": data.type || "audio/webm",
        ...(range ? { "content-range": `bytes ${range.start}-${range.end}/${bytes.byteLength}` } : {})
      }
    });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "语音读取失败。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const form = await request.formData();
    const file = form.get("file");
    const familyId = context.familyId;
    const memberId = context.memberId || null;
    const durationMs = Number(readFormString(form, "duration_ms") || "0");
    const transcribeOnly = readFormString(form, "transcribe_only") === "1";

    if (!(file instanceof File)) {
      return NextResponse.json({ detail: "缺少语音文件。" }, { status: 400 });
    }

    if (file.size > maxVoiceBytes) {
      return NextResponse.json({ detail: "语音文件超过 25MB，无法转写。" }, { status: 413 });
    }

    if (durationMs > 0 && durationMs < 900) {
      return NextResponse.json({ detail: "语音太短，这次没有记录。" }, { status: 400 });
    }

    if (!transcribeOnly && (!supabaseUrl || !supabaseServiceRoleKey || !familyId)) {
      return NextResponse.json(
        { detail: "缺少 Supabase 写入配置：SUPABASE_INTERNAL_URL / SUPABASE_SERVICE_ROLE_KEY。" },
        { status: 500 }
      );
    }

    const transcription = await transcribeAudio(file);
    const transcript = transcription.text;
    if (transcribeOnly) {
      return NextResponse.json({ id: null, status: "transcribed", transcript, transcribeModel: transcription.model });
    }
    const storageUrl = supabaseUrl as string;
    const storageServiceRoleKey = supabaseServiceRoleKey as string;
    const storageFamilyId = familyId as string;
    const supabase: SupabaseClient<Database> = createClient<Database>(storageUrl, storageServiceRoleKey, {
      auth: { persistSession: false }
    });
    const audioPath = await uploadVoiceFile(supabase, file, storageFamilyId);
    const { data, error } = await supabase
      .from("family_records")
      .insert({
        family_id: storageFamilyId,
        member_id: memberId,
        kind: "media",
        title: transcript ? titleFromTranscript(transcript) : "语音记录",
        summary: transcript ? `语音 · ${formatDuration(durationMs)} · ${transcript}` : `语音 · ${formatDuration(durationMs)}`,
        status: "saved",
        tags: ["媒体", "语音"],
        metadata: {
          assetType: "audio",
          audioPath,
          durationMs,
          transcript,
          transcribeModel: transcription.model
        }
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: data.id, status: "saved", transcript });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: error instanceof Error ? error.message : "语音处理失败。" }, { status: 500 });
  }
}

async function transcribeAudio(file: File) {
  let localError: unknown = null;
  try {
    return await transcribeAudioLocally(file);
  } catch (error) {
    localError = error;
  }

  if (openaiApiKey) {
    try {
      return { text: await transcribeAudioWithOpenAI(file), model: transcribeModel };
    } catch (cloudError) {
      const localDetail = localError instanceof Error ? localError.message : "本地语音识别不可用。";
      const cloudDetail = cloudError instanceof Error ? cloudError.message : "云端转写不可用。";
      throw new Error(`${localDetail}；云端转写失败：${cloudDetail}`);
    }
  }

  throw localError instanceof Error ? localError : new Error("本地语音识别不可用。");
}

async function transcribeAudioWithOpenAI(file: File) {
  const form = new FormData();
  form.append("file", file);
  form.append("model", transcribeModel);
  form.append("language", "zh");
  form.append("response_format", "json");
  form.append("prompt", "这是一段家庭协作应用里的中文语音，可能包含家人称呼、待办、资料、链接、媒体等内容。");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiApiKey}` },
    body: form
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI transcription failed: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as { text?: string };
  return (data.text || "").trim();
}

async function uploadVoiceFile(supabase: SupabaseClient<Database>, file: File, familyId: string) {
  const extension = file.name.split(".").pop() || "webm";
  const path = `${familyId}/${new Date().toISOString().slice(0, 10)}/voice-${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(voiceBucket).upload(path, file, {
    contentType: file.type || "audio/webm",
    upsert: false
  });

  if (error) {
    throw new Error(`Supabase storage upload failed: ${error.message}`);
  }

  return `${voiceBucket}/${path}`;
}

function readByteRange(value: string | null, totalBytes: number) {
  const match = value?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || totalBytes <= 0) {
    return null;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : totalBytes - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= totalBytes) {
    return null;
  }
  return { start, end: Math.min(end, totalBytes - 1) };
}

function readFormString(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function titleFromTranscript(transcript: string) {
  return transcript.replace(/\s+/g, " ").slice(0, 24) || "语音记录";
}

function formatDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "未知时长";
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
