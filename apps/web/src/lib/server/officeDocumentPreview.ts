import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const maxOfficePreviewBytes = 48 * 1024 * 1024;

export function isOfficePreviewFile(filename: string, type = "") {
  return /wordprocessingml|msword|spreadsheetml|ms-excel/i.test(type)
    || /\.(docx?|xlsx?|xlsm)$/i.test(filename);
}

export async function ensureOfficePdfPreview(options: { filename?: string; originalPath: string; previewPath: string; type?: string }) {
  if (!isOfficePreviewFile(options.filename || options.originalPath, options.type)) return false;

  try {
    const [original, existing] = await Promise.all([
      stat(options.originalPath),
      stat(options.previewPath).catch(() => null)
    ]);
    if (!original.isFile() || original.size > maxOfficePreviewBytes) return false;
    if (existing?.isFile() && existing.mtimeMs >= original.mtimeMs && existing.size > 0) return true;

    const officeBinary = await findOfficeBinary();
    if (!officeBinary) return false;

    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "family-office-preview-"));
    try {
      const extension = path.extname(options.filename || options.originalPath) || ".docx";
      const inputPath = path.join(temporaryDirectory, `document${extension}`);
      await copyFile(options.originalPath, inputPath);
      await execFileAsync(officeBinary, [
        "--headless",
        `-env:UserInstallation=file://${path.join(temporaryDirectory, "profile")}`,
        "--convert-to",
        "pdf",
        "--outdir",
        temporaryDirectory,
        inputPath
      ], { timeout: 30_000 });
      const pdfName = (await readdir(temporaryDirectory)).find((entry) => entry.toLowerCase().endsWith(".pdf"));
      if (!pdfName) return false;
      await mkdir(path.dirname(options.previewPath), { recursive: true });
      await copyFile(path.join(temporaryDirectory, pdfName), options.previewPath);
      return true;
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  } catch {
    return false;
  }
}

async function findOfficeBinary() {
  const candidates = [
    process.env.LIBREOFFICE_BIN,
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/soffice",
    "/usr/local/bin/libreoffice",
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice"
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (await access(candidate).then(() => true).catch(() => false)) return candidate;
  }
  return null;
}
