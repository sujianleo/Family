import path from "node:path";
import { FileStore } from "@tus/file-store";
import { Server } from "@tus/server";
import { RESOURCE_UPLOAD_MAX_BYTES, validateResourceUploadFile } from "../resourceUploadPolicy";

const tusUploadDir = path.join(process.cwd(), "data", "tus-uploads");

export const tusUploadPath = "/api/tus";

export const tusUploadServer = new Server({
  path: tusUploadPath,
  datastore: new FileStore({
    directory: tusUploadDir
  }),
  maxSize: RESOURCE_UPLOAD_MAX_BYTES,
  async onUploadCreate(_request, upload) {
    const name = upload.metadata?.name || "未命名文件";
    const validation = validateResourceUploadFile({ name, size: upload.size });
    if (!validation.ok) {
      throw {
        body: validation.message,
        status_code: validation.code === "file_too_large" ? 413 : 415
      };
    }
    return { metadata: upload.metadata };
  },
  respectForwardedHeaders: true
});
