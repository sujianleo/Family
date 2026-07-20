import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { ensureOfficePdfPreview } from "./officeDocumentPreview";

const execFileAsync = promisify(execFile);
const documentThumbnailSize = 240;
const maxDocumentThumbnailBytes = 48 * 1024 * 1024;

export async function ensureDocumentThumbnail(options: { filename?: string; originalPath: string; thumbnailPath: string; type?: string }) {
  const kind = documentThumbnailKind(options.filename || options.originalPath, options.type);
  if (!kind) return false;

  try {
    const [original, existing] = await Promise.all([stat(options.originalPath), stat(options.thumbnailPath).catch(() => null)]);
    if (!original.isFile() || original.size > maxDocumentThumbnailBytes) return false;
    if (existing?.isFile() && existing.mtimeMs >= original.mtimeMs && existing.size > 0) return true;

    let image: Buffer | null = null;
    if (kind === "pdf") image = await renderPdfFirstPage(await readFile(options.originalPath));
    if (kind === "word") image = await renderWordFirstPage(options.originalPath, options.filename);
    if (kind === "text") image = await renderTextDocument(await readFile(options.originalPath, "utf8"), path.basename(options.filename || options.originalPath));
    if (kind === "excel") image = await renderSpreadsheetFirstSheet(options.originalPath, options.filename);
    if (!image) return false;

    await mkdir(path.dirname(options.thumbnailPath), { recursive: true });
    await sharp(image, { limitInputPixels: 24_000_000 })
      .flatten({ background: "#ffffff" })
      .resize({ width: documentThumbnailSize, height: documentThumbnailSize, fit: "cover", position: "top" })
      .webp({ alphaQuality: 24, effort: 6, quality: 28, smartSubsample: true })
      .toFile(options.thumbnailPath);
    return true;
  } catch {
    return false;
  }
}

function documentThumbnailKind(filename: string, type = "") {
  if (/pdf/i.test(type) || /\.pdf$/i.test(filename)) return "pdf" as const;
  if (/wordprocessingml|msword/i.test(type) || /\.docx?$/i.test(filename)) return "word" as const;
  if (/spreadsheet|excel/i.test(type) || /\.(xlsx?|xlsm|csv)$/i.test(filename)) return "excel" as const;
  if (/^text\//i.test(type) || /\.(txt|md|json)$/i.test(filename)) return "text" as const;
  return null;
}

async function renderWordFirstPage(originalPath: string, filename?: string) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "family-word-thumbnail-"));
  try {
    const pdfPath = path.join(temporaryDirectory, "document.pdf");
    const ready = await ensureOfficePdfPreview({ filename, originalPath, previewPath: pdfPath });
    if (!ready) return null;
    return await renderPdfFileFirstPage(pdfPath, temporaryDirectory) || await renderPdfFirstPage(await readFile(pdfPath));
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function renderPdfFirstPage(buffer: Buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getScreenshot({ desiredWidth: 480, first: 1, imageBuffer: true, imageDataUrl: false });
    const page = result.pages[0];
    return page?.data ? Buffer.from(page.data) : null;
  } finally {
    await parser.destroy();
  }
}

async function renderTextDocument(content: string, filename: string) {
  const lines = content.replace(/\r/g, "").split("\n").map((line) => line.trimEnd()).filter(Boolean).slice(0, 12);
  const visibleLines = (lines.length ? lines : ["空白文档"]).map((line) => escapeXml(line.slice(0, 30)));
  const title = escapeXml(filename.slice(0, 24));
  const body = visibleLines.map((line, index) => `<text x="26" y="${74 + index * 28}">${line}</text>`).join("");
  const svg = `<svg width="480" height="480" viewBox="0 0 480 480" xmlns="http://www.w3.org/2000/svg">
    <rect width="480" height="480" rx="24" fill="#f7f8f7"/>
    <text x="26" y="40" font-family="-apple-system, BlinkMacSystemFont, PingFang SC, sans-serif" font-size="18" font-weight="700" fill="#6b7471">${title}</text>
    <line x1="26" y1="54" x2="454" y2="54" stroke="#dfe4e1"/>
    <g font-family="-apple-system, BlinkMacSystemFont, PingFang SC, sans-serif" font-size="17" fill="#27312f">${body}</g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderSpreadsheetFirstSheet(originalPath: string, filename?: string) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "family-sheet-thumbnail-"));
  try {
    const extension = path.extname(filename || originalPath) || ".xlsx";
    const inputPath = path.join(temporaryDirectory, `sheet${extension}`);
    await copyFile(originalPath, inputPath);
    const officeBinary = await findOfficeBinary();
    if (!officeBinary) return null;
    await execFileAsync(officeBinary, ["--headless", "--convert-to", "pdf", "--outdir", temporaryDirectory, inputPath], { timeout: 20_000 });
    const pdfName = (await readdir(temporaryDirectory)).find((entry) => entry.toLowerCase().endsWith(".pdf"));
    if (!pdfName) return null;
    const pdfPath = path.join(temporaryDirectory, pdfName);
    const renderedSheet = await renderPdfFileFirstPage(pdfPath, temporaryDirectory) || await renderPdfFirstPage(await readFile(pdfPath));
    return renderedSheet ? focusSpreadsheetContent(renderedSheet) : null;
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function renderPdfFileFirstPage(pdfPath: string, outputDirectory: string) {
  const binary = await findExecutable(["/opt/homebrew/bin/pdftoppm", "/usr/local/bin/pdftoppm"]);
  if (!binary) return null;
  const outputPrefix = path.join(outputDirectory, "sheet-preview");
  await execFileAsync(binary, ["-f", "1", "-singlefile", "-scale-to", "480", "-png", pdfPath, outputPrefix], { timeout: 15_000 });
  return readFile(`${outputPrefix}.png`).catch(() => null);
}

async function focusSpreadsheetContent(image: Buffer) {
  return sharp(image)
    .flatten({ background: "#ffffff" })
    .trim({ background: "#ffffff", threshold: 8 })
    .resize({ width: 430, height: 430, fit: "inside", withoutEnlargement: false })
    .extend({ top: 24, right: 24, bottom: 24, left: 24, background: "#ffffff" })
    .png()
    .toBuffer();
}

async function findOfficeBinary() {
  const candidates = [process.env.LIBREOFFICE_BIN, "/opt/homebrew/bin/soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"].filter((value): value is string => Boolean(value));
  return findExecutable(candidates);
}

async function findExecutable(candidates: string[]) {
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true).catch(() => false)) return candidate;
  }
  return null;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] || character);
}
