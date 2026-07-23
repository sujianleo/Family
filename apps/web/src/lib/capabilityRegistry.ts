import type { AutomationActionId, AutomationPipelineId } from "./automationRegistry";

export type CapabilityModuleId =
  | "app.answer"
  | "app.runtime"
  | "family.members"
  | "groups"
  | "meta"
  | "records"
  | "resources"
  | "safety"
  | "tasks"
  | "web.search";

export type CapabilityBatchPolicy =
  | {
      enabled: false;
      maxCount?: never;
      requiresConfirmation?: never;
    }
  | {
      enabled: true;
      maxCount: number;
      requiresConfirmation: boolean;
    };

export type CapabilityDefinition = {
  actions: AutomationActionId[];
  batch: CapabilityBatchPolicy;
  description: string;
  intents: string[];
  moduleId: CapabilityModuleId;
  moduleLabel: string;
  parameters: string[];
  pipelines: AutomationPipelineId[];
  status: "active" | "planned";
};

export const capabilityRegistry: CapabilityDefinition[] = [
  {
    actions: ["app.runtime.inspect"],
    batch: { enabled: false },
    description: "按时间窗口、模块、级别和错误类别读取脱敏运行摘要，可由 scheduler 调用",
    intents: ["app.runtime.inspect", "app.runtime.status", "app.runtime.errors"],
    moduleId: "app.runtime",
    moduleLabel: "运行诊断",
    parameters: ["hours", "component", "level", "error_type", "limit", "text"],
    pipelines: [],
    status: "active"
  },
  {
    actions: ["app.answer", "member.rename", "profile.describe"],
    batch: { enabled: false },
    description: "家庭成员列表、在线状态、成员画像、成员别名解析和自然语言改名",
    intents: ["system.time", "system.date", "members.count", "members.list", "members.online", "profile.describe", "member.rename"],
    moduleId: "family.members",
    moduleLabel: "家庭成员",
    parameters: ["query_type", "member", "new_name", "text"],
    pipelines: [],
    status: "active"
  },
  {
    actions: ["task.create.approval", "task.create.input", "task.create.multiple_choice"],
    batch: { enabled: false },
    description: "创建任务、开放报名、健康跟进、直接指派、个人待办和任务状态查询",
    intents: ["task.create.open_volunteer", "task.create.health_followup", "task.create.direct_assignment", "task.create.personal_todo", "tasks.outgoing", "tasks.incoming", "tasks.pending"],
    moduleId: "tasks",
    moduleLabel: "任务",
    parameters: ["task_kind", "task_action_type", "assignee_scope", "assignee_ids", "health_subject", "options", "title", "text"],
    pipelines: ["pipeline.task.ai_create"],
    status: "active"
  },
  {
    actions: ["group.create", "group.organize.contextual"],
    batch: { enabled: true, maxCount: 10, requiresConfirmation: true },
    description: "创建群、批量创建群，并根据长对话上下文组群和发布结构化首条消息",
    intents: ["group.create", "group.create.batch", "group.organize.contextual", "group.list", "group.rename"],
    moduleId: "groups",
    moduleLabel: "群组",
    parameters: ["count", "title", "audience", "member_ids", "initial_message", "text"],
    pipelines: [],
    status: "active"
  },
  {
    actions: ["app.answer"],
    batch: { enabled: false },
    description: "资料库查询、附件保存、群聊内容同步资料",
    intents: ["resources.list", "resource.save", "resource.upload", "resource.sync_from_chat"],
    moduleId: "resources",
    moduleLabel: "资料",
    parameters: ["query_type", "source_message_id", "files", "text"],
    pipelines: ["pipeline.chat.save_to_library"],
    status: "active"
  },
  {
    actions: ["app.answer"],
    batch: { enabled: false },
    description: "最近记录查询、记录搜索、删除和归档",
    intents: ["records.recent", "record.search", "record.delete", "record.archive"],
    moduleId: "records",
    moduleLabel: "记录",
    parameters: ["query_type", "record_id", "text"],
    pipelines: [],
    status: "active"
  },
  {
    actions: ["safety.dangerous_operation"],
    batch: { enabled: false },
    description: "识别删除、清空、重置等高危输入，隔离执行链路并返回未执行说明",
    intents: ["safety.dangerous_operation", "data.delete.all", "data.reset", "record.delete.bulk"],
    moduleId: "safety",
    moduleLabel: "安全",
    parameters: ["text", "risk_level", "reason"],
    pipelines: [],
    status: "active"
  },
  {
    actions: ["meta.summary.daily", "meta.summary.weekly", "meta.summary.monthly", "meta.profiles.refresh"],
    batch: { enabled: false },
    description: "人物画像学习、每日总结、每周总结、每月总结和每小时 metadata 自动学习",
    intents: ["meta.summary.daily", "meta.summary.weekly", "meta.summary.monthly", "meta.profiles.refresh", "meta.profile_learning", "meta.hourly_learning"],
    moduleId: "meta",
    moduleLabel: "Meta",
    parameters: ["period", "text"],
    pipelines: ["pipeline.meta.daily_rollup", "pipeline.meta.hourly_learning", "pipeline.meta.profile_learning"],
    status: "active"
  },
  {
    actions: ["web.search.duckduckgo"],
    batch: { enabled: false },
    description: "通过 LangChain DuckDuckGo 工具进行联网搜索，供聊天、资料整理和外部信息查询复用",
    intents: ["web.search.duckduckgo", "web.search"],
    moduleId: "web.search",
    moduleLabel: "联网搜索",
    parameters: ["query", "text", "max_results"],
    pipelines: [],
    status: "active"
  },
  {
    actions: ["app.answer"],
    batch: { enabled: false },
    description: "内部数据问答的兼容入口，负责把 query_type 转给具体模块",
    intents: ["app.answer"],
    moduleId: "app.answer",
    moduleLabel: "APP 问答",
    parameters: ["query_type", "text"],
    pipelines: [],
    status: "active"
  }
];

export function getCapabilityByIntent(intent: string) {
  return capabilityRegistry.find((capability) => capability.intents.includes(intent)) || null;
}

export function getCapabilityByModule(moduleId: CapabilityModuleId) {
  return capabilityRegistry.find((capability) => capability.moduleId === moduleId) || null;
}

export function getCapabilityTableRows() {
  return capabilityRegistry.map((capability) =>
    [
      capability.moduleId,
      capability.moduleLabel,
      capability.intents.join(", "),
      [...capability.actions, ...capability.pipelines].join(", ") || "-",
      capability.batch.enabled ? `yes, max ${capability.batch.maxCount}${capability.batch.requiresConfirmation ? ", confirm" : ""}` : "no",
      capability.parameters.join(", "),
      capability.description
    ].join(" | ")
  );
}

export type AppHelpTopic = {
  entry: string;
  examples: string[];
  keywords: string[];
  label: string;
  limitations?: string;
  summary: string;
};

export const appHelpTopics: AppHelpTopic[] = [
  {
    entry: "主页底部的 AI 输入框",
    examples: ["昨天家里发生了什么", "妈妈的人物画像", "明天 9 点提醒我买药"],
    keywords: ["AI", "助手", "输入框", "能做什么", "能干什么", "功能"],
    label: "AI 助手",
    limitations: "写入任务、长期记忆或修改资料前会先让你确认。",
    summary: "连续聊天、查询家庭记录、任务、资料和画像，也能提出任务或记忆候选。"
  },
  {
    entry: "主页的“任务”区域",
    examples: ["让小明下午拿快递", "明早 9 点提醒我买药"],
    keywords: ["任务", "待办", "提醒", "指派"],
    label: "任务与提醒",
    limitations: "时间或对象不明确时会继续追问，确认后才创建。",
    summary: "支持个人待办、直接指派、开放报名、多选任务和到期提醒。"
  },
  {
    entry: "在主页输入框 @ 家庭成员，或直接说“创建群聊”",
    examples: ["@老婆 @姐姐 周末吃饭", "创建一个周末聚餐群"],
    keywords: ["群聊", "群组", "建群", "创建群"],
    label: "家庭群聊",
    summary: "选择家庭成员创建群聊，发送文字和附件，也可邀请临时访客。"
  },
  {
    entry: "进入群聊，在输入框输入“投票”",
    examples: ["投票", "大家选一下周末去哪"],
    keywords: ["投票", "决定", "表决", "选项"],
    label: "投票与家庭决定",
    limitations: "至少需要一个问题和两个选项；有人投票后不能再改内容。",
    summary: "在群聊里发起投票、收集成员选择，并在结束后生成结果总结。"
  },
  {
    entry: "输入框右侧的回形针，或资料列表",
    examples: ["上传照片", "资料库里有什么", "把这段群聊保存到资料"],
    keywords: ["资料", "资料库", "文件", "照片", "附件", "上传"],
    label: "资料与附件",
    summary: "保存照片、文件、链接和文字资料，也能把群聊内容整理入库。"
  },
  {
    entry: "主页 AI 输入框最左侧按钮",
    examples: ["长按开始说话，识别结果会补到当前光标后"],
    keywords: ["语音", "说话", "麦克风", "长按"],
    label: "语音输入",
    limitations: "是否可用取决于浏览器的麦克风权限和语音识别支持。",
    summary: "长按按钮开始语音输入，保持键盘当前开合状态，并把文字插入光标位置。"
  },
  {
    entry: "设置 → AI",
    examples: ["修改 AI 名称", "设置个性", "查看或补充记忆"],
    keywords: ["AI 名称", "个性", "记忆", "画像", "总结"],
    label: "AI 名称、个性与记忆",
    limitations: "人物画像和长期记忆只采用可信记录；内部证据和测试数据不会展示。",
    summary: "配置助手名称与个性，查看家庭日常总结、人物画像和经确认的长期记忆。"
  },
  {
    entry: "设置 → 网络",
    examples: ["测试公网连接", "测试本地网络", "选择自动连接"],
    keywords: ["网络", "公网", "本地网络", "局域网", "域名", "端口", "连接"],
    label: "网络连接",
    limitations: "自动模式会依据实际可连接状态和延迟选择路径。",
    summary: "配置公网域名与端口、本地地址，并测试公网或局域网连接。"
  },
  {
    entry: "个人资料 → 系统通知",
    examples: ["开启任务提醒", "重新注册通知"],
    keywords: ["通知", "推送", "到期", "后台提醒"],
    label: "系统通知",
    limitations: "需要设备和浏览器授予通知权限。",
    summary: "App 关闭时仍可接收任务、群聊和到期提醒。"
  }
];

export function answerAppCapabilityQuestion(text: string) {
  const normalized = text.trim();
  const topic = [...appHelpTopics]
    .sort((left, right) => Math.max(...right.keywords.map((key) => key.length)) - Math.max(...left.keywords.map((key) => key.length)))
    .find((item) => item.keywords.some((keyword) => normalized.toLowerCase().includes(keyword.toLowerCase())));
  if (!topic || /(?:有哪些|全部|所有|能做什么|能干什么|有啥功能|有什么功能|介绍.*功能)/.test(normalized)) {
    return `这个 App 目前主要有：${appHelpTopics.map((item) => item.label).join("、")}。你可以继续问其中一项，例如“投票怎么用”或“AI 会记住什么”。`;
  }
  return `${topic.label}：${topic.summary} 入口：${topic.entry}。你可以说“${topic.examples[0]}”。${topic.limitations || ""}`.trim();
}
