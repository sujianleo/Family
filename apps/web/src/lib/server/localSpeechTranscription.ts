import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const localTranscribeTimeoutMs = 120_000;

type LocalTranscriptionResult = {
  text: string;
  model: string;
};

export async function transcribeAudioLocally(file: File): Promise<LocalTranscriptionResult> {
  const scriptPath = process.env.LOCAL_TRANSCRIBE_SCRIPT || path.join(process.cwd(), "scripts", "transcribe-local.py");
  const pythonPath = await findPythonRuntime();
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "family-speech-"));
  const audioPath = path.join(tempDirectory, `input.${audioExtension(file)}`);

  try {
    await writeFile(audioPath, Buffer.from(await file.arrayBuffer()));
    const { stdout } = await execFileAsync(pythonPath, [scriptPath, audioPath, "--language", "zh"], {
      timeout: localTranscribeTimeoutMs,
      maxBuffer: 1024 * 1024,
      env: process.env
    });
    const payload = JSON.parse(stdout.trim()) as Partial<LocalTranscriptionResult>;
    if (typeof payload.text !== "string" || typeof payload.model !== "string") {
      throw new Error("本地语音识别返回了无效结果。");
    }
    return { text: payload.text.trim(), model: payload.model };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`本地语音识别失败：${detail.slice(0, 300)}`);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function findPythonRuntime() {
  const candidates = [
    process.env.LOCAL_TRANSCRIBE_PYTHON,
    path.resolve(process.cwd(), "../../.venv/bin/python"),
    "/opt/homebrew/bin/python3.13",
    "python3"
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (candidate === "python3") {
      return candidate;
    }
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next deterministic runtime location.
    }
  }

  throw new Error("找不到本地语音识别的 Python 运行环境。");
}

function audioExtension(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension && /^(webm|wav|mp3|m4a|mp4|mpeg|mpga|ogg|oga|flac)$/.test(extension)) {
    return extension;
  }
  if (file.type.includes("ogg")) return "ogg";
  if (file.type.includes("wav")) return "wav";
  if (file.type.includes("mp4")) return "m4a";
  return "webm";
}
