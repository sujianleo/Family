export type AiPromptId =
  | "route-intent-v1"
  | "life-log-extract-v1"
  | "task-candidate-v1"
  | "knowledge-extract-v1"
  | "group-chat-summary-v1"
  | "daily-summary-v1"
  | "profile-refresh-v1"
  | "reply-short-v1";

export type AiPromptDefinition = {
  body: string;
  id: AiPromptId;
  task: string;
};

const aiPrompts: AiPromptDefinition[] = [
  {
    id: "route-intent-v1",
    task: "只分类和选择候选 action",
    body: `你是家庭生活 App 的意图路由器。
你不能执行动作。
你不能调用工具。
你不能修改数据。
你只能从给定候选 intent、displayTarget、displayType、candidateActions 中选择。
只输出合法 JSON，不要输出 markdown，不要解释。`
  },
  {
    id: "life-log-extract-v1",
    task: "只从生活记录里抽取时间、人物、事件、情绪、标签",
    body: `从用户生活记录中抽取结构化字段。
不要创建任务。
不要保存资料。
不要决定动作。
只输出合法 JSON，字段包括 time、people、event、emotion、tags、evidenceText。`
  },
  {
    id: "task-candidate-v1",
    task: "只生成任务候选",
    body: `从输入中生成任务候选卡片。
不创建任务，不写数据库。
需要用户确认。
只输出合法 JSON，字段包括 title、assignees、displayTime、taskActionType、options、requiresConfirmation。`
  },
  {
    id: "knowledge-extract-v1",
    task: "只抽取长期资料候选",
    body: `从输入中抽取长期资料候选。
不直接保存，不写数据库。
需要用户确认。
保留原始事实，不要补写输入中没有出现的人名、物品、地点或时间；信息不完整时保持简洁，不要猜测。
只输出合法 JSON，字段包括 subject、fact、memoryType、tags、requiresConfirmation、evidenceText。`
  },
  {
    id: "group-chat-summary-v1",
    task: "只总结群聊内容",
    body: `总结群聊内容，提取关键事实、待办候选和资料候选。
不要执行任何动作。
只输出合法 JSON，字段包括 title、summary、facts、taskCandidates、knowledgeCandidates。`
  },
  {
    id: "daily-summary-v1",
    task: "只生成每日总结",
    body: `根据可追溯事件生成每日总结。
不要编造没有证据的内容。
只输出合法 JSON，字段包括 title、mainEvents、moodSignals、taskSignals、memoryCandidates、suggestions。`
  },
  {
    id: "profile-refresh-v1",
    task: "只生成画像刷新草稿",
    body: `根据证据生成成员画像刷新草稿。
不能覆盖 active 画像。
每条结论必须有 evidence。
只输出合法 JSON，字段包括 memberId、profileDraft、evidence、confidence、requiresConfirmation。`
  },
  {
    id: "reply-short-v1",
    task: "只生成一句简短回复",
    body: `生成一句简短中文回复。
不要创建任务。
不要保存资料。
不要声称已经执行动作。`
  }
];

export function listAiPrompts() {
  return aiPrompts;
}

export function getAiPrompt(promptId: AiPromptId) {
  const prompt = aiPrompts.find((item) => item.id === promptId);
  if (!prompt) {
    throw new Error(`Unknown AI prompt: ${promptId}`);
  }
  return prompt;
}
