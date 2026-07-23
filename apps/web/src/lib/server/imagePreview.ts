import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const supportedImageTypes = new Set(["image/avif", "image/gif", "image/heic", "image/heif", "image/jpeg", "image/png", "image/webp"]);
export const compressedImageMaxDimension = 1280;
export const compressedImageQuality = 60;
export const thumbnailImageMaxDimension = 240;
export const thumbnailImageQuality = 28;

export async function ensureCompressedImagePreview(options: { originalPath: string; previewPath: string; type?: string }) {
  if (!isCompressibleImage(options.originalPath, options.type)) {
    return false;
  }

  try {
    const [original, existing] = await Promise.all([stat(options.originalPath), stat(options.previewPath).catch(() => null)]);
    if (existing?.isFile() && existing.mtimeMs >= original.mtimeMs && existing.size > 0) {
      return true;
    }

    await mkdir(path.dirname(options.previewPath), { recursive: true });
    await sharp(options.originalPath, { animated: false, limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: compressedImageMaxDimension, height: compressedImageMaxDimension, fit: "inside", withoutEnlargement: true })
      .webp({ effort: 5, quality: compressedImageQuality, smartSubsample: true })
      .toFile(options.previewPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureCompressedImageThumbnail(options: { originalPath: string; thumbnailPath: string; type?: string }) {
  if (!isCompressibleImage(options.originalPath, options.type)) {
    return false;
  }

  try {
    const [original, existing] = await Promise.all([stat(options.originalPath), stat(options.thumbnailPath).catch(() => null)]);
    if (existing?.isFile() && existing.mtimeMs >= original.mtimeMs && existing.size > 0) {
      return true;
    }

    await mkdir(path.dirname(options.thumbnailPath), { recursive: true });
    await sharp(options.originalPath, { animated: false, limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: thumbnailImageMaxDimension, height: thumbnailImageMaxDimension, fit: "cover", position: "attention", withoutEnlargement: true })
      .webp({ alphaQuality: 24, effort: 6, quality: thumbnailImageQuality, smartSubsample: true })
      .toFile(options.thumbnailPath);
    return true;
  } catch {
    return false;
  }
}

function isCompressibleImage(filePath: string, type?: string) {
  if (type && supportedImageTypes.has(type.toLowerCase())) {
    return true;
  }
  return /\.(avif|heic|heif|jpe?g|png|webp)$/i.test(filePath);
}
