import { tusUploadServer } from "@/lib/server/tusUploadServer";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return tusUploadServer.handleWeb(request);
}

export async function HEAD(request: Request) {
  return tusUploadServer.handleWeb(request);
}

export async function OPTIONS(request: Request) {
  return tusUploadServer.handleWeb(request);
}

export async function PATCH(request: Request) {
  return tusUploadServer.handleWeb(request);
}

export async function POST(request: Request) {
  return tusUploadServer.handleWeb(request);
}

export async function DELETE(request: Request) {
  return tusUploadServer.handleWeb(request);
}
