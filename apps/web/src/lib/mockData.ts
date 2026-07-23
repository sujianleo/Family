import type { FamilyMember, FamilyRecord, RoomMessage } from "./types";
import { DEFAULT_ASSISTANT_NAME } from "./assistantIdentity";

// Synthetic public-demo records only. No runtime user or family data is included.
export const familyMembers: FamilyMember[] = [
  {
    id: "me",
    displayName: "小明",
    role: "成员",
    relationshipRole: "child",
    profile: {
      defaultLocation: {
        label: "常驻地",
        province: "示例省",
        city: "示例市",
        district: "示例区",
        address: "示例地址",
        lat: 0,
        lon: 0,
        source: "manual",
        updatedAt: "2026-06-08T00:00:00+08:00"
      }
    },
    status: "online",
    avatarSeed: "current-member",
    color: "#2f6f68"
  },
  {
    id: "wife",
    displayName: "老婆",
    role: "成员",
    relationshipRole: "spouse",
    profile: {
      defaultLocation: {
        label: "常驻地",
        province: "示例省",
        city: "示例市",
        district: "示例区",
        address: "示例地址",
        lat: 0,
        lon: 0,
        source: "manual",
        updatedAt: "2026-06-08T00:00:00+08:00"
      }
    },
    status: "online",
    avatarSeed: "wife",
    color: "#9b6a42"
  },
  {
    id: "sister",
    displayName: "姐姐",
    role: "成员",
    relationshipRole: "relative",
    profile: {
      defaultLocation: {
        label: "常驻地",
        province: "示例省",
        city: "示例市",
        district: "示例区",
        address: "示例地址",
        lat: 0,
        lon: 0,
        source: "manual",
        updatedAt: "2026-06-08T00:00:00+08:00"
      }
    },
    status: "away",
    avatarSeed: "sister",
    color: "#5e6fb2"
  },
  {
    id: "mom",
    displayName: "老妈",
    role: "成员",
    relationshipRole: "parent",
    profile: {
      defaultLocation: {
        label: "常驻地",
        province: "示例省",
        city: "示例市",
        district: "示例区",
        address: "示例地址",
        lat: 0,
        lon: 0,
        source: "manual",
        updatedAt: "2026-06-08T00:00:00+08:00"
      }
    },
    status: "online",
    avatarSeed: "mom",
    color: "#b15d6a"
  },
  {
    id: "dad",
    displayName: "爸爸",
    role: "成员",
    relationshipRole: "parent",
    profile: {
      defaultLocation: {
        label: "常驻地",
        province: "示例省",
        city: "示例市",
        district: "示例区",
        address: "示例地址",
        lat: 0,
        lon: 0,
        source: "manual",
        updatedAt: "2026-06-08T00:00:00+08:00"
      }
    },
    status: "online",
    avatarSeed: "dad",
    color: "#4f6f9f"
  },
  {
    id: "daughter",
    displayName: "闺女",
    role: "成员",
    relationshipRole: "child",
    profile: {
      defaultLocation: {
        label: "学校/常驻地",
        province: "示例省",
        city: "示例市",
        district: "示例区",
        address: "示例地址",
        lat: 0,
        lon: 0,
        source: "manual",
        updatedAt: "2026-06-08T00:00:00+08:00"
      }
    },
    status: "away",
    avatarSeed: "daughter",
    color: "#9a6ab1"
  },
  {
    id: "son",
    displayName: "儿子",
    role: "成员",
    relationshipRole: "child",
    profile: {
      defaultLocation: {
        label: "学校/常驻地",
        province: "示例省",
        city: "示例市",
        district: "示例区",
        address: "示例地址",
        lat: 0,
        lon: 0,
        source: "manual",
        updatedAt: "2026-06-08T00:00:00+08:00"
      }
    },
    status: "online",
    avatarSeed: "son",
    color: "#3f8a7c"
  },
  {
    id: "fanmili",
    displayName: DEFAULT_ASSISTANT_NAME,
    role: "家庭助手",
    relationshipRole: "friend",
    householdRoles: ["assistant", "default"],
    profile: {
      occupation: "家庭默认助手",
      interests: ["整理家庭信息", "提醒健康跟进", "协助任务指派"],
      careNotes: ["名称后期可以通过自然语言修改"]
    },
    status: "online",
    avatarSeed: "fanmili",
    color: "#d08a3c"
  },
  {
    id: "backfill",
    displayName: "Backfill",
    role: "成员",
    relationshipRole: "guest",
    profile: {},
    status: "away",
    avatarSeed: "backfill",
    color: "#6f7f8f"
  },
  {
    id: "guest-cousin",
    displayName: "表哥",
    role: "访客",
    relationshipRole: "guest",
    profile: {},
    status: "online",
    avatarSeed: "guest-cousin",
    color: "#6f7f8f"
  },
  {
    id: "guest-friend",
    displayName: "朋友",
    role: "访客",
    relationshipRole: "guest",
    profile: {},
    status: "online",
    avatarSeed: "guest-friend",
    color: "#7c6f8f"
  }
];

export const familyRecords: FamilyRecord[] = [
  {
    id: "guest-chat-cousin",
    kind: "task",
    title: "周末聚餐临时群聊",
    summary: "爸爸、姐姐、表哥、朋友已加入",
    ownerName: "小明",
    createdByMemberId: "me",
    assigneeMemberIds: [],
    spaceId: "core",
    audience: "guest",
    assignmentStatus: "assigned",
    assignmentReason: "创建了一个非家人群聊入口",
    taskActionType: "approval",
    taskResponses: [],
    inviteLink: "https://family-app.example.com/guest/chat/AqR7mN9pX4sT2vB8cLdE6fGh",
    chatMembers: ["me", "dad", "sister", "guest-cousin", "guest-friend"],
    chatMessages: [
      {
        id: "c1",
        senderName: "访客",
        senderAvatarSeed: "guest-cousin",
        senderMemberId: "guest-cousin",
        body: "上传了 1 张图片",
        sentAt: "19:45",
        type: "file",
        files: [{ name: "周末聚餐照片.jpg", previewUrl: "https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=640&q=80", type: "image/jpeg" }]
      },
      { id: "c2", senderName: "小明", senderMemberId: "me", senderAvatarSeed: "current-member", body: "周末几点聚餐？", sentAt: "19:46", mine: true },
      { id: "c3", senderName: "老婆", senderMemberId: "wife", senderAvatarSeed: "wife", body: "我看晚上 7 点怎么样？", sentAt: "19:47" }
    ],
    status: "todo",
    updatedAt: "19:45",
    tags: ["群聊"]
  },
  {
    id: "tomato-egg",
    kind: "task",
    title: "今天想吃西红柿炒鸡蛋",
    summary: "儿子发起晚饭请求",
    ownerName: "小明",
    createdByMemberId: "me",
    assigneeMemberIds: ["wife", "mom"],
    spaceId: "core",
    audience: "core",
    assignmentStatus: "assigned",
    assignmentReason: "包含吃饭或做菜请求",
    taskActionType: "approval",
    taskResponses: [
      { memberId: "wife", memberName: "老婆", status: "pending" },
      { memberId: "mom", memberName: "老妈", status: "pending" }
    ],
    status: "todo",
    updatedAt: "刚刚",
    tags: ["待办", "吃饭"]
  },
  {
    id: "wash-sheets",
    kind: "task",
    title: "今天的床单是不是该洗了",
    summary: "儿子发起家务提醒",
    ownerName: "小明",
    createdByMemberId: "me",
    assigneeMemberIds: ["mom"],
    spaceId: "core",
    audience: "core",
    assignmentStatus: "assigned",
    assignmentReason: "包含清洁或家务提醒",
    taskActionType: "approval",
    taskResponses: [{ memberId: "mom", memberName: "老妈", status: "pending" }],
    status: "todo",
    updatedAt: "刚刚",
    tags: ["待办", "家务"]
  },
  {
    id: "dinner",
    kind: "task",
    title: "明天早餐吃什么",
    summary: "明天 09:00，需要确认早餐安排",
    ownerName: "老婆",
    createdByMemberId: "wife",
    assigneeMemberIds: ["me"],
    spaceId: "core",
    audience: "core",
    assignmentStatus: "assigned",
    assignmentReason: "老婆提醒你确认明天早餐安排",
    taskActionType: "input",
    taskResponses: [{ memberId: "me", memberName: "小明", status: "pending" }],
    status: "todo",
    updatedAt: "10:31",
    tags: ["待办", "明天"]
  },
  {
    id: "clean",
    kind: "task",
    title: "周末家庭大扫除",
    summary: "周六 10:00，分配清洁区域",
    ownerName: "老妈",
    createdByMemberId: "mom",
    assigneeMemberIds: ["me"],
    spaceId: "core",
    audience: "core",
    assignmentStatus: "assigned",
    assignmentReason: "清洁员发起家务分工，需要你确认清洁区域",
    taskActionType: "multiple_choice",
    taskOptions: ["客厅", "厨房", "卫生间", "卧室"],
    taskResponses: [{ memberId: "me", memberName: "小明", status: "pending" }],
    status: "doing",
    updatedAt: "10:12",
    tags: ["进行中", "家庭"]
  },
  {
    id: "travel",
    kind: "note",
    title: "旅行攻略 - 云南篇",
    summary: "来自 Alice，包含行程草案和待确认事项",
    ownerName: "Alice",
    assetType: "text",
    fileName: "旅行攻略 - 云南篇",
    createdByMemberId: "sister",
    assigneeMemberIds: ["me"],
    spaceId: "core",
    audience: "core",
    assignmentStatus: "assigned",
    assignmentReason: "资料协作需要你确认行程草案",
    status: "saved",
    updatedAt: "09:42",
    tags: ["资料", "旅行"]
  },
  {
    id: "album",
    kind: "media",
    title: "家庭相册备份",
    summary: "来自 Backfill，已归类到媒体",
    ownerName: "Backfill",
    assetType: "photo",
    previewUrl: "/showcase/family-dinner.webp",
    status: "saved",
    updatedAt: "昨天",
    tags: ["媒体"]
  },
  {
    id: "living-room-photo",
    kind: "media",
    title: "客厅改造前照片",
    summary: "图片 · 3 张 · 需要确认保留哪一版",
    ownerName: "老婆",
    assetType: "photo",
    previewUrl: "/showcase/family-picnic.webp",
    status: "saved",
    updatedAt: "11:12",
    tags: ["媒体", "图片"]
  },
  {
    id: "mom-voice-note",
    kind: "media",
    title: "老妈语音留言",
    summary: "语音 · 00:42 · 周末聚餐提醒",
    ownerName: "老妈",
    assetType: "audio",
    durationMs: 42000,
    fileName: "老妈语音留言.m4a",
    transcript: "周末聚餐记得早点回来，我把要买的菜写好了，到家前跟我说一声。",
    status: "saved",
    updatedAt: "11:06",
    tags: ["媒体", "语音"]
  },
  {
    id: "ticket-screenshot",
    kind: "media",
    title: "机票截图汇总",
    summary: "图片 · 2 张 · 来自姐姐",
    ownerName: "姐姐",
    assetType: "photo",
    previewUrl: "/showcase/family-reunion.webp",
    status: "saved",
    updatedAt: "10:58",
    tags: ["媒体", "图片"]
  },
  {
    id: "doc",
    kind: "link",
    title: "家庭旅行计划文档",
    summary: "Google Docs 文档，5 人查看过",
    ownerName: "小明",
    assetType: "word",
    fileName: "家庭旅行计划文档.docx",
    status: "saved",
    updatedAt: "10:30",
    tags: ["链接", "资料"]
  }
];

export const roomMessages: RoomMessage[] = [
  { id: "m1", senderName: "小明", body: "我发了链接，大家进来聊。", sentAt: "10:31", mine: true },
  { id: "m2", senderName: "老婆", body: "我进来了。", sentAt: "10:32" },
  { id: "m3", senderName: "姐姐", body: "机票我来查一下吧", sentAt: "10:33" },
  { id: "m4", senderName: "Backfill", body: "我把之前去的攻略发出来给大家参考。", sentAt: "10:36" }
];
