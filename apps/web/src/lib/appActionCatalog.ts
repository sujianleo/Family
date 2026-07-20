import { automationActions, type AutomationSideEffectLevel } from "./automationRegistry";

export type AppActionDomain =
  | "assistant"
  | "auth"
  | "family"
  | "group"
  | "invite"
  | "judgement"
  | "notification"
  | "poll"
  | "profile"
  | "rag"
  | "record"
  | "resource"
  | "safety"
  | "summary"
  | "task"
  | "web";

export type AppActionDefinition = {
  aiCallable: boolean;
  description: string;
  domain: AppActionDomain;
  executionSurface: "api" | "automation" | "local-ui";
  id: string;
  label: string;
  parameters: string[];
  requiresConfirmation: boolean;
  sideEffectLevel: AutomationSideEffectLevel;
  source: string;
};

const domainByAutomationPrefix: Record<string, AppActionDomain> = {
  app: "assistant",
  background: "assistant",
  decision: "poll",
  group: "group",
  invite: "invite",
  member: "family",
  memory: "profile",
  meta: "summary",
  profile: "profile",
  safety: "safety",
  summary: "summary",
  task: "task",
  web: "web"
};

const surfacedActions: AppActionDefinition[] = [
  appAction("auth.login", "登录", "auth", "api", true, "low", "src/app/api/auth/login/route.ts"),
  appAction("auth.logout", "退出登录", "auth", "api", true, "medium", "src/app/api/auth/logout/route.ts"),
  appAction("auth.registration.request", "申请注册", "auth", "api", true, "medium", "src/app/api/auth/registration-request/route.ts"),
  appAction("assistant.config.update", "更新助手配置", "assistant", "api", true, "medium", "src/app/api/assistant-config/route.ts"),
  appAction("assistant.preferences.update", "更新助手偏好", "assistant", "api", true, "medium", "src/app/api/assistant-preferences/route.ts"),
  appAction("member.self.rename", "修改自己的名字", "profile", "local-ui", true, "medium", "src/components/settings-drawer.tsx"),
  appAction("family.member.remove", "移除家庭成员", "family", "local-ui", true, "high", "src/components/settings-drawer.tsx"),
  appAction("family.join.review", "审核加入家庭", "family", "api", true, "high", "src/app/api/family-join-requests/[requestId]/review/route.ts"),
  appAction("record.delete", "删除记录", "record", "local-ui", true, "high", "src/components/record-list.tsx"),
  appAction("record.restore", "撤销删除记录", "record", "local-ui", false, "medium", "src/components/record-list.tsx"),
  appAction("record.open", "打开记录", "record", "local-ui", false, "none", "src/components/record-list.tsx"),
  appAction("task.complete", "完成任务", "task", "local-ui", false, "medium", "src/components/record-list.tsx"),
  appAction("task.respond", "回应任务", "task", "local-ui", false, "medium", "src/components/record-list.tsx"),
  appAction("task.delete", "删除任务", "task", "local-ui", true, "high", "src/components/record-list.tsx"),
  appAction("task.restore", "恢复任务", "task", "local-ui", false, "medium", "src/components/record-list.tsx"),
  appAction("group.attachment.add", "发送群附件", "group", "local-ui", false, "medium", "src/components/record-list.tsx"),
  appAction("group.member.add", "添加群成员", "group", "local-ui", true, "medium", "src/components/record-list.tsx"),
  appAction("group.member.remove", "移除群成员", "group", "local-ui", true, "high", "src/components/record-list.tsx"),
  appAction("group.rename", "修改群名", "group", "local-ui", true, "medium", "src/components/record-list.tsx"),
  appAction("group.message.save_resource", "群消息存为资料", "resource", "local-ui", false, "medium", "src/components/record-list.tsx"),
  appAction("group.message.create_task", "群消息转任务", "task", "local-ui", true, "medium", "src/components/record-list.tsx"),
  appAction("poll.create", "发起投票", "poll", "api", true, "medium", "src/app/api/family-decisions/route.ts"),
  appAction("poll.update", "修改投票", "poll", "api", true, "medium", "src/app/api/family-decisions/[id]/route.ts"),
  appAction("poll.vote", "投票", "poll", "api", false, "medium", "src/app/api/family-decisions/[id]/vote/route.ts"),
  appAction("poll.close", "结束投票", "poll", "api", true, "high", "src/app/api/family-decisions/[id]/close/route.ts"),
  appAction("poll.adopt_task", "采纳投票结果为任务", "poll", "api", true, "high", "src/app/api/family-decisions/[id]/adopt/route.ts"),
  appAction("judgement.draft", "生成评评理草稿", "judgement", "api", false, "low", "src/app/api/group-judgements/draft/route.ts"),
  appAction("judgement.stance", "评评理表态", "judgement", "api", false, "medium", "src/app/api/group-judgements/[id]/stance/route.ts"),
  appAction("judgement.suggest", "AI 建议评评理立场", "judgement", "api", false, "low", "src/app/api/group-judgements/[id]/suggest/route.ts"),
  appAction("judgement.extend", "延长评评理", "judgement", "api", true, "medium", "src/app/api/group-judgements/[id]/extend/route.ts"),
  appAction("judgement.resolve", "裁决评评理", "judgement", "api", true, "high", "src/app/api/group-judgements/[id]/resolve/route.ts"),
  appAction("judgement.close", "结束评评理", "judgement", "api", true, "high", "src/app/api/group-judgements/[id]/close/route.ts"),
  appAction("resource.upload", "上传资料", "resource", "local-ui", false, "medium", "src/components/record-list.tsx"),
  appAction("resource.download", "下载资料", "resource", "local-ui", false, "low", "src/components/record-list.tsx"),
  appAction("notification.read", "读取通知", "notification", "api", false, "low", "src/app/api/notifications/route.ts"),
  appAction("notification.clear", "清除通知", "notification", "local-ui", true, "medium", "src/components/notification-center.tsx"),
  appAction("notification.preferences.update", "更新通知设置", "notification", "api", true, "medium", "src/app/api/notification-preferences/route.ts"),
  appAction("voice.transcribe", "语音转文字", "assistant", "api", false, "low", "src/app/api/voice-notes/route.ts")
];

export const appActionCatalog: AppActionDefinition[] = [
  ...automationActions.map<AppActionDefinition>((action) => ({
    aiCallable: true,
    description: action.description,
    domain: domainByAutomationPrefix[action.id.split(".")[0]] || "assistant",
    executionSurface: action.kind === "local-ui" ? "local-ui" : "automation",
    id: action.id,
    label: action.label,
    parameters: Object.keys(action.parameters || {}),
    requiresConfirmation: action.requiresConfirmation,
    sideEffectLevel: action.sideEffectLevel,
    source: "src/lib/automationRegistry.ts"
  })),
  ...surfacedActions
];

export function listAiCallableAppActions() {
  return appActionCatalog.filter((action) => action.aiCallable);
}

export function getAppAction(id: string) {
  return appActionCatalog.find((action) => action.id === id) || null;
}

function appAction(
  id: string,
  label: string,
  domain: AppActionDomain,
  executionSurface: AppActionDefinition["executionSurface"],
  requiresConfirmation: boolean,
  sideEffectLevel: AutomationSideEffectLevel,
  source: string
): AppActionDefinition {
  return {
    aiCallable: false,
    description: `${label}的现有 APP 动作面；进入 AI 编排前必须先实现参数契约和执行适配器。`,
    domain,
    executionSurface,
    id,
    label,
    parameters: [],
    requiresConfirmation,
    sideEffectLevel,
    source
  };
}
