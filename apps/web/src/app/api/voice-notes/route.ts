import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { FamilyRecord } from "@/lib/types";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { createFamilyRecordStore } from "@/lib/server/familyRecordStore";
import { transcribeAudioLocally } from "@/lib/server/localSpeechTranscription";

export const runtime = "nodejs";
const maxVoiceBytes = 25 * 1024 * 1024;

const openaiApiKey = process.env.OPENAI_API_KEY;
const transcribeModel = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const voiceRoot = path.join(process.cwd(), "data", "voice-notes");

export async function GET(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const requestedPath = new URL(request.url).searchParams.get("path") || "";
    const relativePath = requestedPath.replace(/^voice-notes\//, "");
    if (!relativePath.startsWith(`${context.familyId}/`) || relativePath.includes("..")) {
      return NextResponse.json({ detail: "无权访问这条语音。" }, { status: 403 });
    }
    const absolutePath = path.resolve(voiceRoot, relativePath);
    if (!absolutePath.startsWith(`${path.resolve(voiceRoot)}${path.sep}`)) {
      return NextResponse.json({ detail: "无权访问这条语音。" }, { status: 403 });
    }
    const bytes = new Uint8Array(await readFile(absolutePath));
    const range = readByteRange(request.headers.get("range"), bytes.byteLength);
    const payload = range ? bytes.slice(range.start, range.end + 1) : bytes;
    return new Response(payload, {
      status: range ? 206 : 200,
      headers: {
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=300",
        "content-length": String(payload.byteLength),
        "content-type": contentTypeForPath(relativePath),
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

    const transcription = await transcribeAudio(file);
    const transcript = transcription.text;
    if (transcribeOnly) {
      return NextResponse.json({ id: null, status: "transcribed", transcript, transcribeModel: transcription.model });
    }
    const audioPath = await saveVoiceFile(file, familyId);
    const record: FamilyRecord = {
      assetType: "audio",
      audioPath: `/api/voice-notes?path=${encodeURIComponent(audioPath)}`,
      durationMs,
      id: crypto.randomUUID(),
      kind: "media",
      ownerName: "家庭成员",
      status: "saved",
      summary: transcript ? `语音 · ${formatDuration(durationMs)} · ${transcript}` : `语音 · ${formatDuration(durationMs)}`,
      tags: ["媒体", "语音"],
      title: transcript ? titleFromTranscript(transcript) : "语音记录",
      transcript,
      updatedAt: "刚刚"
    };
    const saved = await createFamilyRecordStore().save({
      familyId,
      memberId: memberId || "me",
      record
    });
    return NextResponse.json({ id: saved.id, status: "saved", transcript });
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

async function saveVoiceFile(file: File, familyId: string) {
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "webm";
  const relativePath = `${familyId}/${new Date().toISOString().slice(0, 10)}/voice-${crypto.randomUUID()}.${extension}`;
  const absolutePath = path.join(voiceRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, new Uint8Array(await file.arrayBuffer()));
  return `voice-notes/${relativePath}`;
}

function contentTypeForPath(value: string) {
  if (/\.m4a$/i.test(value)) return "audio/mp4";
  if (/\.mp3$/i.test(value)) return "audio/mpeg";
  if (/\.wav$/i.test(value)) return "audio/wav";
  if (/\.ogg$/i.test(value)) return "audio/ogg";
  return "audio/webm";
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
