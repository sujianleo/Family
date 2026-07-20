import type { Json, RoomMessage } from "./types";
import { familyFetch } from "./familyApi";

export type MetaEventType =
  | "app_chat_turn"
  | "assistant_clarification_choice"
  | "composer_input"
  | "daily_life_log"
  | "group_chat_message"
  | "group_invite_copied"
  | "group_title_update"
  | "group_attachment_selected"
  | "automation_run"
  | "record_deleted"
  | "resource_saved"
  | "resource_uploaded"
  | "task_created"
  | "task_completed"
  | "task_reopened"
  | "task_response"
  | "member_profile_refresh";

export type MetaEvent = {
  id: string;
  type: MetaEventType | string;
  actor_member_id: string | null;
  actor_name: string | null;
  record_id: string | null;
  space_id: string | null;
  text: string;
  metadata: Json;
  created_at: string;
};

export type NewMetaEvent = {
  type: MetaEventType;
  actorMemberId?: string;
  actorName?: string;
  recordId?: string;
  spaceId?: string;
  text?: string;
  metadata?: Json;
};

export async function enqueueMetaEvent(event: NewMetaEvent) {
  try {
    const res = await familyFetch("/api/meta-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: event.type,
        actor_member_id: event.actorMemberId,
        actor_name: event.actorName,
        record_id: event.recordId,
        space_id: event.spaceId,
        text: event.text || "",
        metadata: event.metadata ?? null
      })
    });

    if (!res.ok) {
      return null;
    }

    return (await res.json()) as { id: string };
  } catch {
    return null;
  }
}

export async function fetchMetaEvents(params: { recordId?: string; type?: MetaEventType } = {}) {
  const searchParams = new URLSearchParams();
  if (params.recordId) {
    searchParams.set("record_id", params.recordId);
  }
  if (params.type) {
    searchParams.set("type", params.type);
  }

  const res = await familyFetch(`/api/meta-events${searchParams.size ? `?${searchParams}` : ""}`, {
    cache: "no-store"
  });

  if (!res.ok) {
    return [];
  }

  const data = (await res.json()) as { events?: MetaEvent[] };
  return data.events || [];
}

export function metaEventsToRoomMessages(events: MetaEvent[], currentActorId = "me"): RoomMessage[] {
  return events
    .filter((event) => (event.type === "group_chat_message" && event.text) || event.type === "group_attachment_selected")
    .map((event) => {
      const metadata = isRecord(event.metadata) ? event.metadata : {};
      const files = Array.isArray(metadata.files)
        ? metadata.files
            .filter(isRecord)
            .map((file) => {
              const name = typeof file.name === "string" ? file.name : "未命名文件";
              const type = typeof file.type === "string" ? file.type : undefined;
              const url = normalizeStoredFileUrl(typeof file.url === "string" ? file.url : undefined);
              const originalUrl = normalizeStoredFileUrl(typeof file.originalUrl === "string" ? file.originalUrl : undefined);
              const previewUrl = normalizeStoredFileUrl(typeof file.previewUrl === "string" ? file.previewUrl : undefined);
              const thumbnailUrl = normalizeStoredFileUrl(typeof file.thumbnailUrl === "string" ? file.thumbnailUrl : undefined);
              return {
                cacheUrl: typeof file.cacheUrl === "string" ? file.cacheUrl : undefined,
                name,
                originalUrl,
                previewUrl: previewUrl || (isImageReference(name, type) ? url || originalUrl : undefined),
                thumbnailUrl,
                size: typeof file.size === "number" ? file.size : undefined,
                storage: typeof file.storage === "string" ? file.storage : undefined,
                type,
                url
              };
            })
        : undefined;
      const messageId = typeof metadata.messageId === "string" ? metadata.messageId : event.id;
      const guestAvatarSeed = typeof metadata.guestAvatarSeed === "string" ? metadata.guestAvatarSeed : undefined;
      const stickerId = typeof metadata.stickerId === "string" ? metadata.stickerId : undefined;

      return {
        id: messageId,
        senderName: event.actor_name || "我",
        senderAvatarSeed: guestAvatarSeed,
        senderMemberId: event.actor_member_id || undefined,
        stickerId,
        body: event.type === "group_attachment_selected" ? event.text || files?.map((file) => file.name).join("、") || "附件" : event.text,
        sentAt: formatMessageTime(event.created_at),
        type: event.type === "group_attachment_selected" ? "file" : "text",
        files,
        mine: event.actor_member_id === currentActorId
      };
    });
}

function isRecord(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeStoredFileUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  if (value.startsWith("blob:")) {
    return undefined;
  }

  try {
    const url = new URL(value, "http://local.family");
    const match = url.pathname.match(/\/api\/tus\/([^/?#]+)/);
    if (match) {
      return `/api/guest-uploads?tus=${encodeURIComponent(match[1])}`;
    }
  } catch {
    const match = value.match(/\/api\/tus\/([^/?#]+)/);
    if (match) {
      return `/api/guest-uploads?tus=${encodeURIComponent(match[1])}`;
    }
  }

  return value;
}

function isImageReference(name: string, type?: string) {
  return Boolean(type?.startsWith("image/")) || /\.(png|jpe?g|gif|webp|heic)$/i.test(name);
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
