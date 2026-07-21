export type AutomationActionId =
  | "app.answer"
  | "app.chat"
  | "app.runtime.inspect"
  | "assistant.suggest.next"
  | "scheduler.job.create"
  | "scheduler.job.cancel"
  | "member.rename"
  | "member.knowledge.resolve"
  | "member.knowledge.ask"
  | "member.knowledge.provide_input"
  | "member.knowledge.dismiss"
  | "member.knowledge.collect_reply"
  | "member.knowledge.followup"
  | "invite.create"
  | "invite.accept"
  | "invite.revoke"
  | "safety.dangerous_operation"
  | "profile.avatar"
  | "profile.describe"
  | "group.create"
  | "group.organize.contextual"
  | "group.ask.family"
  | "group.message.send"
  | "decision.create.quick"
  | "judgement.create"
  | "record.organize"
  | "resource.organize"
  | "rag.query.family"
  | "rag.query.resources"
  | "rag.query.memory"
  | "task.create.approval"
  | "task.create.input"
  | "task.create.multiple_choice"
  | "web.search.duckduckgo"
  | "summary.personal.daily"
  | "summary.personal.weekly"
  | "summary.family.daily"
  | "summary.family.weekly"
  | "summary.family.monthly"
  | "memory.save"
  | "memory.extract.family"
  | "profile.refresh.deep"
  | "background.organize.daily"
  | "meta.summary.daily"
  | "meta.summary.weekly"
  | "meta.summary.monthly"
  | "meta.profiles.refresh";

export type AutomationActionKind = "local-ui" | "server";
export type AutomationSideEffectLevel = "none" | "low" | "medium" | "high";
export type AutomationUnitKind = "action" | "pipeline";

export type AutomationActionDefinition = {
  id: AutomationActionId;
  unit: "action";
  kind: AutomationActionKind;
  label: string;
  description: string;
  requiresConfirmation: boolean;
  sideEffectLevel: AutomationSideEffectLevel;
  slashAliases: string[];
  parameters?: Record<string, "string" | "number" | "boolean">;
};

export type AutomationPipelineId =
  | "pipeline.meta.daily_rollup"
  | "pipeline.meta.hourly_learning"
  | "pipeline.meta.profile_learning"
  | "pipeline.chat.save_to_library"
  | "pipeline.task.ai_create"
  | "pipeline.summary.daily"
  | "pipeline.summary.weekly"
  | "pipeline.summary.monthly"
  | "pipeline.profile.deep_refresh";

export type AutomationPipelineStep = {
  actionId: AutomationActionId;
  map?: Record<string, string>;
  when?: string;
};

export type AutomationPipelineDefinition = {
  id: AutomationPipelineId;
  unit: "pipeline";
  label: string;
  description: string;
  slashAliases: string[];
  parameters?: Record<string, "string" | "number" | "boolean">;
  steps: AutomationPipelineStep[];
};

export type AutomationUnitDefinition = AutomationActionDefinition | AutomationPipelineDefinition;

export const automationActions: AutomationActionDefinition[] = [
  {
    id: "app.answer",
    unit: "action",
    kind: "server",
    label: "APP 问答",
    description: "回答 APP 内部数据相关问题",
    requiresConfirmation: false,
    sideEffectLevel: "none",
    slashAliases: ["问答", "查询", "app.ask", "家里有哪些人", "家庭成员"],
    parameters: {
      query_type: "string",
      text: "string"
    }
  },
  {
    id: "app.chat",
    unit: "action",
    kind: "server",
    label: "闲聊",
    description: "没有命中本地数据和任务意图时，作为 AI 对话直接回复",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: ["聊天", "闲聊", "chat"],
    parameters: {
      text: "string"
    }
  },
  {
    id: "app.runtime.inspect",
    unit: "action",
    kind: "server",
    label: "运行诊断",
    description: "按时间、模块、级别和错误类别读取脱敏运行摘要，不读取聊天正文或整份日志",
    requiresConfirmation: false,
    sideEffectLevel: "none",
    slashAliases: ["运行状态", "系统诊断", "最近报错", "runtime.inspect"],
    parameters: {
      component: "string",
      error_type: "string",
      hours: "number",
      level: "string",
      limit: "number",
      text: "string"
    }
  },
  {
    id: "assistant.suggest.next",
    unit: "action",
    kind: "server",
    label: "AI 建议",
    description: "基于用户原文或带证据的家庭上下文生成下一步建议，不执行写入动作",
    requiresConfirmation: false,
    sideEffectLevel: "none",
    slashAliases: ["AI建议", "下一步建议", "suggest.next"],
    parameters: {
      text: "string"
    }
  },
  {
    id: "scheduler.job.create",
    unit: "action",
    kind: "server",
    label: "创建定时 Action",
    description: "确认后把白名单 action 写入 scheduler，到点执行并记录结果",
    requiresConfirmation: true,
    sideEffectLevel: "medium",
    slashAliases: ["定时执行", "scheduler.create"],
    parameters: {
      action_id: "string",
      run_at: "string",
      text: "string"
    }
  },
  {
    id: "scheduler.job.cancel",
    unit: "action",
    kind: "server",
    label: "取消定时 Action",
    description: "确认后取消仍在等待中的 scheduler job",
    requiresConfirmation: true,
    sideEffectLevel: "medium",
    slashAliases: ["取消定时", "scheduler.cancel"],
    parameters: {
      job_id: "string",
      text: "string"
    }
  },
  {
    id: "member.rename",
    unit: "action",
    kind: "server",
    label: "成员改名",
    description: "通过自然语言修改家庭成员显示名称",
    requiresConfirmation: true,
    sideEffectLevel: "medium",
    slashAliases: ["改名", "成员改名", "rename.member"],
    parameters: {
      member: "string",
      new_name: "string",
      text: "string"
    }
  },
  {
    id: "member.knowledge.resolve",
    unit: "action",
    kind: "server",
    label: "核实家人信息",
    description: "先检索可引用的家庭依据；没有可靠命中时，生成只询问目标家人的定向群聊问题",
    requiresConfirmation: false,
    sideEffectLevel: "medium",
    slashAliases: ["核实家人信息", "member.knowledge.resolve"],
    parameters: {
      member: "string",
      member_id: "string",
      text: "string"
    }
  },
  {
    id: "member.knowledge.ask",
    unit: "action",
    kind: "server",
    label: "向本人核实",
    description: "把信息核实流程切换为等待目标家人本人回复",
    requiresConfirmation: false,
    sideEffectLevel: "medium",
    slashAliases: [],
    parameters: { inquiry_id: "string", text: "string" }
  },
  {
    id: "member.knowledge.provide_input",
    unit: "action",
    kind: "server",
    label: "补充本轮信息",
    description: "把发起人的补充作为本轮可见依据，不自动写入长期记忆",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: [],
    parameters: { inquiry_id: "string", text: "string" }
  },
  {
    id: "member.knowledge.dismiss",
    unit: "action",
    kind: "server",
    label: "暂不核实",
    description: "结束当前信息核实流程，不发送消息也不写入资料",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: [],
    parameters: { inquiry_id: "string", text: "string" }
  },
  {
    id: "member.knowledge.collect_reply",
    unit: "action",
    kind: "server",
    label: "收集本人回复",
    description: "只接受目标家人本人的群聊回复并据此完成信息核实",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: [],
    parameters: { inquiry_id: "string", text: "string" }
  },
  {
    id: "member.knowledge.followup",
    unit: "action",
    kind: "server",
    label: "温和重问信息",
    description: "scheduler 可控地重问仍未回复的目标家人，同一问题最多两次",
    requiresConfirmation: false,
    sideEffectLevel: "medium",
    slashAliases: [],
    parameters: { inquiry_id: "string", text: "string" }
  },
  {
    id: "invite.create",
    unit: "action",
    kind: "server",
    label: "邀请成员候选",
    description: "生成邀请成员的确认卡片，不直接邀请或授权",
    requiresConfirmation: true,
    sideEffectLevel: "high",
    slashAliases: ["邀请", "邀请成员", "invite.create"],
    parameters: {
      member: "string",
      text: "string"
    }
  },
  {
    id: "invite.accept",
    unit: "action",
    kind: "local-ui",
    label: "接受邀请",
    description: "验证邀请和当前登录身份后创建成员关系",
    requiresConfirmation: true,
    sideEffectLevel: "high",
    slashAliases: ["接受邀请", "加入家庭", "加入群聊", "invite.accept"],
    parameters: { invite_id: "string", code: "string", display_name: "string" }
  },
  {
    id: "invite.revoke",
    unit: "action",
    kind: "local-ui",
    label: "撤销邀请",
    description: "立即使指定邀请链接和验证码失效",
    requiresConfirmation: true,
    sideEffectLevel: "high",
    slashAliases: ["撤销邀请", "invite.revoke"],
    parameters: { invite_id: "string" }
  },
  {
    id: "safety.dangerous_operation",
    unit: "action",
    kind: "server",
    label: "危险操作隔离",
    description: "识别删除、清空、重置等高危输入，只记录拦截结果，不执行真实操作",
    requiresConfirmation: false,
    sideEffectLevel: "none",
    slashAliases: ["危险操作", "删除所有数据", "清空全部数据", "safety"],
    parameters: {
      text: "string"
    }
  },
  {
    id: "profile.avatar",
    unit: "action",
    kind: "local-ui",
    label: "头像",
    description: "选择或上传我的头像",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: ["头像", "换头像", "avatar"]
  },
  {
    id: "profile.describe",
    unit: "action",
    kind: "server",
    label: "人物画像",
    description: "输出指定成员的人物画像",
    requiresConfirmation: false,
    sideEffectLevel: "none",
    slashAliases: ["人物画像", "查看画像", "profile"],
    parameters: {
      member: "string",
      text: "string"
    }
  },
  {
    id: "group.create",
    unit: "action",
    kind: "server",
    label: "群聊",
    description: "创建一个可分享的临时聊天任务",
    requiresConfirmation: false,
    sideEffectLevel: "medium",
    slashAliases: ["群聊", "建群", "创建群", "创建群聊", "group"],
    parameters: {
      text: "string",
      title: "string"
    }
  },
  {
    id: "group.organize.contextual",
    unit: "action",
    kind: "local-ui",
    label: "上下文组群",
    description: "根据已确认的家庭活动上下文创建群聊，并由家庭助手发布结构化邀请",
    requiresConfirmation: false,
    sideEffectLevel: "medium",
    slashAliases: [],
    parameters: {
      text: "string"
    }
  },
  {
    id: "group.ask.family",
    unit: "action",
    kind: "local-ui",
    label: "询问家人",
    description: "根据家庭协作问题创建群聊，并由家庭助手向相关家人发出询问",
    requiresConfirmation: false,
    sideEffectLevel: "medium",
    slashAliases: [],
    parameters: {
      text: "string"
    }
  },
  {
    id: "group.message.send",
    unit: "action",
    kind: "local-ui",
    label: "发送群消息",
    description: "向已解析的家庭群发送消息；必须携带目标群和原始用户授权上下文",
    requiresConfirmation: false,
    sideEffectLevel: "medium",
    slashAliases: ["发送群消息", "group.message.send"],
    parameters: {
      room_id: "string",
      text: "string"
    }
  },
  {
    id: "decision.create.quick",
    unit: "action",
    kind: "local-ui",
    label: "家庭决定",
    description: "打开需要确认的家庭快速选择创建卡，不直接写入数据",
    requiresConfirmation: true,
    sideEffectLevel: "medium",
    slashAliases: [],
    parameters: {
      text: "string"
    }
  },
  {
    id: "judgement.create",
    unit: "action",
    kind: "local-ui",
    label: "发起评评理",
    description: "打开评评理草稿与确认界面，确认后才正式发起",
    requiresConfirmation: true,
    sideEffectLevel: "medium",
    slashAliases: ["评评理", "judgement.create"],
    parameters: {
      text: "string"
    }
  },
  {
    id: "record.organize",
    unit: "action",
    kind: "local-ui",
    label: "及时整理",
    description: "按用户指定范围整理家庭记录，先展示范围与变更确认卡",
    requiresConfirmation: true,
    sideEffectLevel: "medium",
    slashAliases: ["及时整理", "整理家庭记录", "record.organize"],
    parameters: {
      text: "string"
    }
  },
  {
    id: "resource.organize",
    unit: "action",
    kind: "local-ui",
    label: "整理资料",
    description: "按用户指定规则整理资料库，先展示将要改变的分类",
    requiresConfirmation: true,
    sideEffectLevel: "medium",
    slashAliases: ["整理资料", "resource.organize"],
    parameters: {
      text: "string"
    }
  },
  {
    id: "rag.query.family",
    unit: "action",
    kind: "server",
    label: "查询家庭依据",
    description: "从家庭时间线和记录中检索可引用依据，只读不写入",
    requiresConfirmation: false,
    sideEffectLevel: "none",
    slashAliases: ["查询家庭记录", "rag.family"],
    parameters: { text: "string" }
  },
  {
    id: "rag.query.resources",
    unit: "action",
    kind: "server",
    label: "查询资料依据",
    description: "从资料与附件中检索可引用依据，只读不写入",
    requiresConfirmation: false,
    sideEffectLevel: "none",
    slashAliases: ["查询资料", "rag.resources"],
    parameters: { text: "string" }
  },
  {
    id: "rag.query.memory",
    unit: "action",
    kind: "server",
    label: "查询确认记忆",
    description: "只召回已经确认的家庭记忆并返回证据标识",
    requiresConfirmation: false,
    sideEffectLevel: "none",
    slashAliases: ["查询记忆", "rag.memory"],
    parameters: { text: "string" }
  },
  {
    id: "task.create.approval",
    unit: "action",
    kind: "server",
    label: "同意任务",
    description: "创建一个需要对方同意或不同意的任务",
    requiresConfirmation: true,
    sideEffectLevel: "medium",
    slashAliases: ["同意任务", "确认任务", "approval"],
    parameters: {
      text: "string",
      title: "string"
    }
  },
  {
    id: "task.create.input",
    unit: "action",
    kind: "server",
    label: "填写任务",
    description: "创建一个需要对方返回文字内容的任务",
    requiresConfirmation: true,
    sideEffectLevel: "medium",
    slashAliases: ["填写任务", "输入任务", "问答任务", "input"],
    parameters: {
      text: "string",
      title: "string"
    }
  },
  {
    id: "task.create.multiple_choice",
    unit: "action",
    kind: "server",
    label: "多选任务",
    description: "创建一个需要对方从多个选项中选择的任务",
    requiresConfirmation: true,
    sideEffectLevel: "medium",
    slashAliases: ["多选任务", "选择任务", "multiple_choice"],
    parameters: {
      text: "string",
      title: "string",
      options: "string"
    }
  },
  {
    id: "web.search.duckduckgo",
    unit: "action",
    kind: "server",
    label: "联网搜索",
    description: "通过 LangChain DuckDuckGo 工具执行联网搜索，并把搜索结果写入 metadata",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: ["联网搜索", "网络搜索", "搜索一下", "duckduckgo", "web.search"],
    parameters: {
      query: "string",
      text: "string"
    }
  },
  {
    id: "summary.personal.daily",
    unit: "action",
    kind: "server",
    label: "个人日总结",
    description: "使用 DeepSeek V4 基于可追溯来源生成个人日总结",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: ["总结今天", "今日总结", "我的日总结", "个人日总结"],
    parameters: {
      actor_member_id: "string",
      end_time: "string",
      family_id: "string",
      start_time: "string",
      text: "string"
    }
  },
  {
    id: "summary.personal.weekly",
    unit: "action",
    kind: "server",
    label: "个人周总结",
    description: "使用 DeepSeek V4 基于可追溯来源生成个人周总结",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: ["总结本周", "本周总结", "我的周总结", "个人周总结"],
    parameters: {
      actor_member_id: "string",
      end_time: "string",
      family_id: "string",
      start_time: "string",
      text: "string"
    }
  },
  {
    id: "summary.family.daily",
    unit: "action",
    kind: "server",
    label: "家庭日总结",
    description: "使用 DeepSeek V4 基于可追溯来源生成家庭日总结",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: ["家庭日总结", "全家日总结", "总结今天全家"],
    parameters: {
      end_time: "string",
      family_id: "string",
      start_time: "string",
      text: "string"
    }
  },
  {
    id: "summary.family.weekly",
    unit: "action",
    kind: "server",
    label: "家庭周总结",
    description: "使用 DeepSeek V4 基于可追溯来源生成家庭周总结",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: ["家庭周总结", "全家周总结", "总结本周全家"],
    parameters: {
      end_time: "string",
      family_id: "string",
      start_time: "string",
      text: "string"
    }
  },
  {
    id: "summary.family.monthly",
    unit: "action",
    kind: "server",
    label: "家庭月总结",
    description: "使用 DeepSeek V4 基于可追溯来源生成家庭月总结",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: ["家庭月总结", "全家月总结", "总结本月全家"],
    parameters: {
      end_time: "string",
      family_id: "string",
      start_time: "string",
      text: "string"
    }
  },
  {
    id: "memory.extract.family",
    unit: "action",
    kind: "server",
    label: "长期记忆候选提炼",
    description: "使用 DeepSeek V4 生成长期家庭记忆候选，只保存候选等待用户确认",
    requiresConfirmation: true,
    sideEffectLevel: "medium",
    slashAliases: ["提炼长期记忆", "家庭记忆候选", "memory.extract.family"],
    parameters: {
      end_time: "string",
      family_id: "string",
      start_time: "string",
      text: "string"
    }
  },
  {
    id: "memory.save",
    unit: "action",
    kind: "server",
    label: "资料保存候选",
    description: "生成长期资料保存候选，不直接写入资料库",
    requiresConfirmation: true,
    sideEffectLevel: "medium",
    slashAliases: ["保存资料", "记一下", "记下来", "memory.save"],
    parameters: {
      subject: "string",
      text: "string"
    }
  },
  {
    id: "profile.refresh.deep",
    unit: "action",
    kind: "server",
    label: "深度画像草稿",
    description: "使用 DeepSeek V4 生成成员画像刷新草稿，不直接覆盖 active 画像",
    requiresConfirmation: true,
    sideEffectLevel: "medium",
    slashAliases: ["深度刷新画像", "画像草稿", "profile.refresh.deep"],
    parameters: {
      end_time: "string",
      family_id: "string",
      start_time: "string",
      text: "string"
    }
  },
  {
    id: "background.organize.daily",
    unit: "action",
    kind: "server",
    label: "后台每日整理",
    description: "增量整理家庭时间线、任务候选、记忆候选和任务健康信号，不直接修改正式家庭数据",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: [],
    parameters: {
      end_time: "string",
      force: "boolean",
      start_time: "string",
      time_zone: "string"
    }
  },
  {
    id: "meta.summary.daily",
    unit: "action",
    kind: "server",
    label: "每日总结",
    description: "压缩今天的 meta facts，生成 daily context",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: ["每日总结", "今天总结", "daily", "总结今天"]
  },
  {
    id: "meta.summary.weekly",
    unit: "action",
    kind: "server",
    label: "每周总结",
    description: "基于每日压缩生成 weekly context",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: ["每周总结", "周总结", "weekly", "总结本周"]
  },
  {
    id: "meta.summary.monthly",
    unit: "action",
    kind: "server",
    label: "每月总结",
    description: "基于每周压缩生成 monthly context",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    slashAliases: ["每月总结", "月总结", "monthly", "总结本月"]
  },
  {
    id: "meta.profiles.refresh",
    unit: "action",
    kind: "server",
    label: "刷新画像",
    description: "从 meta facts 中提取每个人的人物画像派生数据",
    requiresConfirmation: false,
    sideEffectLevel: "medium",
    slashAliases: ["刷新画像", "profiles.refresh", "画像刷新"]
  }
];

export const automationPipelines: AutomationPipelineDefinition[] = [
  {
    id: "pipeline.meta.daily_rollup",
    unit: "pipeline",
    label: "每日整理",
    description: "先压缩当天 meta facts，再刷新人物画像",
    slashAliases: ["每日整理", "今天整理", "daily_rollup"],
    steps: [{ actionId: "meta.summary.daily" }, { actionId: "meta.profiles.refresh" }]
  },
  {
    id: "pipeline.meta.hourly_learning",
    unit: "pipeline",
    label: "每小时 metadata 学习",
    description: "App 内部每小时自动压缩 metadata，并刷新 AI 人物画像",
    slashAliases: ["每小时整理", "每小时学习", "metadata.hourly", "自动学习metadata"],
    steps: [{ actionId: "meta.summary.daily" }, { actionId: "meta.profiles.refresh" }]
  },
  {
    id: "pipeline.meta.profile_learning",
    unit: "pipeline",
    label: "画像学习",
    description: "基于全部 meta facts 学习并更新每个人的人物画像",
    slashAliases: ["画像学习", "学习画像", "整理画像", "更新画像", "刷新画像", "整理人物画像", "更新人物画像", "profile_learning"],
    steps: [{ actionId: "meta.profiles.refresh" }]
  },
  {
    id: "pipeline.chat.save_to_library",
    unit: "pipeline",
    label: "群聊入库",
    description: "把选中的群聊文字、照片或文件整理进资料库",
    slashAliases: ["群聊入库", "同步资料", "save_chat"],
    steps: [{ actionId: "meta.profiles.refresh", when: "after_resource_saved" }]
  },
  {
    id: "pipeline.task.ai_create",
    unit: "pipeline",
    label: "AI 创建任务",
    description: "先理解任务类型，再调用同意、填写或多选任务 Action",
    slashAliases: ["AI任务", "创建任务", "task_ai"],
    parameters: {
      text: "string"
    },
    steps: [
      { actionId: "task.create.approval", when: "intent.taskActionType == approval" },
      { actionId: "task.create.input", when: "intent.taskActionType == input" },
      { actionId: "task.create.multiple_choice", when: "intent.taskActionType == multiple_choice" }
    ]
  },
  {
    id: "pipeline.summary.daily",
    unit: "pipeline",
    label: "每日深度总结",
    description: "使用 DeepSeek V4 生成每日总结卡片",
    slashAliases: ["深度日总结", "每日深度总结", "summary.daily"],
    parameters: {
      text: "string"
    },
    steps: [{ actionId: "summary.family.daily" }]
  },
  {
    id: "pipeline.summary.weekly",
    unit: "pipeline",
    label: "每周深度总结",
    description: "使用 DeepSeek V4 生成每周总结卡片",
    slashAliases: ["深度周总结", "每周深度总结", "summary.weekly"],
    parameters: {
      text: "string"
    },
    steps: [{ actionId: "summary.family.weekly" }]
  },
  {
    id: "pipeline.summary.monthly",
    unit: "pipeline",
    label: "每月深度总结",
    description: "使用 DeepSeek V4 生成每月总结卡片",
    slashAliases: ["深度月总结", "每月深度总结", "summary.monthly"],
    parameters: {
      text: "string"
    },
    steps: [{ actionId: "summary.family.monthly" }]
  },
  {
    id: "pipeline.profile.deep_refresh",
    unit: "pipeline",
    label: "深度画像刷新草稿",
    description: "先提炼家庭记忆候选，再生成画像刷新草稿，等待用户确认",
    slashAliases: ["深度画像刷新", "profile.deep_refresh"],
    parameters: {
      text: "string"
    },
    steps: [{ actionId: "memory.extract.family" }, { actionId: "profile.refresh.deep" }]
  }
];

export const automationUnits: AutomationUnitDefinition[] = [...automationActions, ...automationPipelines];

export function matchAutomationAction(inputValue: string) {
  const query = inputValue.trim().replace(/^\/+/, "").trim().toLowerCase();
  if (!query) {
    return null;
  }

  return (
    automationActions.find((action) =>
      action.slashAliases.some((alias) => query === alias.toLowerCase() || query.startsWith(`${alias.toLowerCase()} `))
    ) || null
  );
}

export function matchAutomationUnit(inputValue: string) {
  const query = inputValue.trim().replace(/^\/+/, "").trim().toLowerCase();
  if (!query) {
    return null;
  }

  return (
    automationUnits.find((unit) =>
      unit.slashAliases.some((alias) => query === alias.toLowerCase() || query.startsWith(`${alias.toLowerCase()} `))
    ) || null
  );
}

export function getAutomationAction(actionId: string) {
  return automationActions.find((action) => action.id === actionId) || null;
}
