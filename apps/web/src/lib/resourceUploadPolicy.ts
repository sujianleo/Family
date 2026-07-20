export const RESOURCE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const RESOURCE_UPLOAD_MAX_LABEL = "20MB";
export const RESOURCE_UPLOAD_ACCEPT = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".txt",
  ".md",
  ".csv",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".heic",
  ".heif"
].join(",");

const allowedExtensions = new Set(RESOURCE_UPLOAD_ACCEPT.split(","));
const analyzableDocumentExtensions = new Set([".pdf", ".docx", ".xlsx", ".txt", ".md", ".csv"]);

export type ResourceUploadValidation =
  | { ok: true }
  | { ok: false; code: "file_too_large" | "unsupported_type"; message: string };

export function validateResourceUploadFile(file: { name: string; size?: number }): ResourceUploadValidation {
  if (typeof file.size === "number" && file.size > RESOURCE_UPLOAD_MAX_BYTES) {
    return {
      code: "file_too_large",
      message: `“${file.name}”超过单个文件 ${RESOURCE_UPLOAD_MAX_LABEL} 的限制。`,
      ok: false
    };
  }
  if (!allowedExtensions.has(fileExtension(file.name))) {
    return {
      code: "unsupported_type",
      message: `“${file.name}”格式不支持。请上传 Word（.docx）、TXT、PDF、Excel（.xlsx）或常见图片。`,
      ok: false
    };
  }
  return { ok: true };
}

export function isAnalyzableDocumentFile(file: { name: string }) {
  return analyzableDocumentExtensions.has(fileExtension(file.name));
}

function fileExtension(name: string) {
  const match = name.trim().toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] || "";
}
