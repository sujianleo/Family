import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { ensureCompressedImagePreview, ensureCompressedImageThumbnail } from "@/lib/server/imagePreview";
import { ensureDocumentThumbnail } from "@/lib/server/documentThumbnail";
import { ensureOfficePdfPreview } from "@/lib/server/officeDocumentPreview";

const uploadRoot = path.join(process.cwd(), "data", "guest-uploads");
const tusUploadRoot = path.join(process.cwd(), "data", "tus-uploads");
const uploadPreviewRoot = path.join(uploadRoot, ".previews");
const tusPreviewRoot = path.join(tusUploadRoot, ".previews");
const uploadThumbnailRoot = path.join(uploadRoot, ".thumbnails");
const tusThumbnailRoot = path.join(tusUploadRoot, ".thumbnails");
const uploadDocumentPreviewRoot = path.join(uploadRoot, ".documents");
const tusDocumentPreviewRoot = path.join(tusUploadRoot, ".documents");

export const runtime = "nodejs";

export async function GET(request: Request) {
  return readUpload(request, false);
}

export async function HEAD(request: Request) {
  return readUpload(request, true);
}

async function readUpload(request: Request, headOnly: boolean) {
  const { searchParams } = new URL(request.url);
  const tusId = sanitizeSegment(searchParams.get("tus") || "");
  const requestedVariant = searchParams.get("variant");
  const variant = requestedVariant === "thumbnail" ? "thumbnail" : requestedVariant === "preview" ? "preview" : requestedVariant === "document" ? "document" : "original";
  if (tusId) {
    return readTusUpload(tusId, variant, headOnly);
  }

  const filePath = sanitizeRelativePath(searchParams.get("file") || "");

  if (!filePath) {
    return uploadErrorResponse("缺少文件路径。", 400, headOnly);
  }

  try {
    const absolutePath = path.join(uploadRoot, filePath);
    if (variant === "document") {
      const documentPreviewPath = previewPathFor(uploadDocumentPreviewRoot, filePath, ".pdf");
      const documentPreviewReady = await ensureOfficePdfPreview({ filename: filePath, originalPath: absolutePath, previewPath: documentPreviewPath, type: contentTypeFor(filePath) });
      if (documentPreviewReady) {
        return await streamStoredUpload(documentPreviewPath, `${filePath}.preview.pdf`, "application/pdf", headOnly);
      }
      return uploadErrorResponse("该 Office 文件暂时无法转换为预览。", 422, headOnly);
    }
    if (variant === "thumbnail") {
      const thumbnailPath = previewPathFor(uploadThumbnailRoot, filePath);
      const thumbnailReady = await ensureResourceThumbnail({ filename: filePath, originalPath: absolutePath, thumbnailPath, type: contentTypeFor(filePath) });
      if (thumbnailReady) {
        return await streamStoredUpload(thumbnailPath, `${filePath}.thumbnail.webp`, "image/webp", headOnly);
      }
    } else if (variant === "preview") {
      const previewPath = previewPathFor(uploadPreviewRoot, filePath);
      const previewReady = await ensureCompressedImagePreview({ originalPath: absolutePath, previewPath, type: contentTypeFor(filePath) });
      if (previewReady) {
        return await streamStoredUpload(previewPath, `${filePath}.webp`, "image/webp", headOnly);
      }
    }
    return await streamStoredUpload(absolutePath, filePath, contentTypeFor(filePath), headOnly);
  } catch {
    return uploadErrorResponse("文件不存在。", 404, headOnly);
  }
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.includes("application/json")) {
    return createTusPreviews(request);
  }

  const formData = await request.formData();
  const recordId = sanitizeSegment(readFormString(formData, "recordId") || "guest-chat");
  const messageId = sanitizeSegment(readFormString(formData, "messageId") || `message-${Date.now()}`);
  const files = formData.getAll("files").filter((item): item is File => item instanceof File);

  if (!files.length) {
    return NextResponse.json({ files: [] });
  }

  const storedFiles = [];
  for (const [index, file] of files.entries()) {
    const safeName = sanitizeFileName(file.name || `file-${index}`);
    const relativePath = path.join(recordId, messageId, `${index}-${safeName}`);
    const absolutePath = path.join(uploadRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

    const fileUrl = `/api/guest-uploads?file=${encodeURIComponent(relativePath)}`;
    const previewPath = previewPathFor(uploadPreviewRoot, relativePath);
    const previewReady = await ensureCompressedImagePreview({ originalPath: absolutePath, previewPath, type: file.type });
    const previewUrl = previewReady ? `${fileUrl}&variant=preview` : file.type.startsWith("image/") ? fileUrl : undefined;
    const thumbnailPath = previewPathFor(uploadThumbnailRoot, relativePath);
    const thumbnailReady = await ensureResourceThumbnail({ filename: file.name, originalPath: absolutePath, thumbnailPath, type: file.type });
    const thumbnailUrl = thumbnailReady ? `${fileUrl}&variant=thumbnail` : previewUrl;
    storedFiles.push({
      name: file.name || safeName,
      originalUrl: fileUrl,
      previewUrl,
      thumbnailUrl,
      size: file.size,
      storage: "server-file",
      type: file.type,
      url: previewUrl || fileUrl
    });
  }

  return NextResponse.json({ files: storedFiles });
}

async function createTusPreviews(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { tusIds?: unknown };
  const tusIds = Array.isArray(body.tusIds) ? body.tusIds.map((value) => sanitizeSegment(typeof value === "string" ? value : "")).filter(Boolean) : [];
  const files = await Promise.all(tusIds.map(createTusPreviewReference));
  return NextResponse.json({ files });
}

async function createTusPreviewReference(tusId: string) {
  const metadata = await readTusMetadata(tusId);
  const originalPath = path.join(tusUploadRoot, tusId);
  const originalUrl = `/api/guest-uploads?tus=${encodeURIComponent(tusId)}`;
  const previewReady = await ensureCompressedImagePreview({
    originalPath,
    previewPath: path.join(tusPreviewRoot, `${tusId}.webp`),
    type: metadata.filetype
  });
  const previewUrl = previewReady ? `${originalUrl}&variant=preview` : originalUrl;
  const thumbnailReady = await ensureResourceThumbnail({
    filename: metadata.filename,
    originalPath,
    thumbnailPath: path.join(tusThumbnailRoot, `${tusId}.webp`),
    type: metadata.filetype
  });
  const thumbnailUrl = thumbnailReady ? `${originalUrl}&variant=thumbnail` : previewReady ? previewUrl : undefined;
  return {
    name: metadata.filename || tusId,
    originalUrl,
    previewUrl,
    thumbnailUrl,
    storage: "tus",
    type: metadata.filetype,
    url: previewUrl
  };
}

async function readTusUpload(tusId: string, variant: "document" | "original" | "preview" | "thumbnail", headOnly: boolean) {
  try {
    const absolutePath = path.join(tusUploadRoot, tusId);
    const metadata = await readTusMetadata(tusId);
    if (variant === "document") {
      const documentPreviewPath = path.join(tusDocumentPreviewRoot, `${tusId}.pdf`);
      const documentPreviewReady = await ensureOfficePdfPreview({ filename: metadata.filename, originalPath: absolutePath, previewPath: documentPreviewPath, type: metadata.filetype });
      if (documentPreviewReady) {
        return await streamStoredUpload(documentPreviewPath, `${metadata.filename || tusId}.preview.pdf`, "application/pdf", headOnly);
      }
      return uploadErrorResponse("该 Office 文件暂时无法转换为预览。", 422, headOnly);
    }
    if (variant === "thumbnail") {
      const thumbnailPath = path.join(tusThumbnailRoot, `${tusId}.webp`);
      const thumbnailReady = await ensureResourceThumbnail({ filename: metadata.filename, originalPath: absolutePath, thumbnailPath, type: metadata.filetype });
      if (thumbnailReady) {
        return await streamStoredUpload(thumbnailPath, `${metadata.filename || tusId}.thumbnail.webp`, "image/webp", headOnly);
      }
    } else if (variant === "preview") {
      const previewPath = path.join(tusPreviewRoot, `${tusId}.webp`);
      const previewReady = await ensureCompressedImagePreview({ originalPath: absolutePath, previewPath, type: metadata.filetype });
      if (previewReady) {
        return await streamStoredUpload(previewPath, `${metadata.filename || tusId}.webp`, "image/webp", headOnly);
      }
    }
    return await streamStoredUpload(absolutePath, metadata.filename || tusId, metadata.filetype || contentTypeFor(metadata.filename || tusId), headOnly);
  } catch {
    return uploadErrorResponse("文件不存在。", 404, headOnly);
  }
}

async function ensureResourceThumbnail(options: { filename?: string; originalPath: string; thumbnailPath: string; type?: string }) {
  return await ensureCompressedImageThumbnail(options) || await ensureDocumentThumbnail(options);
}

function previewPathFor(root: string, relativePath: string, extension = ".webp") {
  return path.join(root, `${relativePath}${extension}`);
}

async function streamStoredUpload(absolutePath: string, displayName: string, contentType: string, headOnly: boolean) {
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    return uploadErrorResponse("文件不存在。", 404, headOnly);
  }

  const headers = new Headers({
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(displayName) || "file")}`,
    "content-length": String(fileStat.size),
    "content-type": contentType
  });

  if (headOnly) {
    return new Response(null, { headers });
  }

  return new Response(Readable.toWeb(createReadStream(absolutePath)) as ReadableStream, { headers });
}

function uploadErrorResponse(detail: string, status: number, headOnly: boolean) {
  if (headOnly) {
    return new Response(null, { status });
  }
  return NextResponse.json({ detail }, { status });
}

async function readTusMetadata(tusId: string) {
  try {
    const content = await readFile(path.join(tusUploadRoot, `${tusId}.json`), "utf8");
    const parsed = JSON.parse(content) as { metadata?: { filename?: unknown; filetype?: unknown } };
    return {
      filename: typeof parsed.metadata?.filename === "string" ? parsed.metadata.filename : "",
      filetype: typeof parsed.metadata?.filetype === "string" ? parsed.metadata.filetype : ""
    };
  } catch {
    return {
      filename: "",
      filetype: ""
    };
  }
}

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function sanitizeRelativePath(value: string) {
  const normalized = path.normalize(decodeURIComponent(value)).replace(/^(\.\.[/\\])+/, "");
  return normalized
    .split(path.sep)
    .map(sanitizeSegment)
    .filter(Boolean)
    .join(path.sep);
}

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "file";
}

function contentTypeFor(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if ([".jpg", ".jpeg"].includes(extension)) {
    return "image/jpeg";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".pdf") {
    return "application/pdf";
  }
  if (extension === ".txt") {
    return "text/plain; charset=utf-8";
  }
  if (extension === ".csv") {
    return "text/csv; charset=utf-8";
  }
  if (extension === ".doc") {
    return "application/msword";
  }
  if (extension === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (extension === ".xls") {
    return "application/vnd.ms-excel";
  }
  if (extension === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (extension === ".mp3") {
    return "audio/mpeg";
  }
  if (extension === ".m4a") {
    return "audio/mp4";
  }
  if (extension === ".wav") {
    return "audio/wav";
  }
  if (extension === ".mp4") {
    return "video/mp4";
  }
  if (extension === ".mov") {
    return "video/quicktime";
  }
  return "application/octet-stream";
}
