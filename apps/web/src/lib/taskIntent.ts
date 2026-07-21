import type { TaskActionType, TaskRecurrence } from "./types";
import { extractTemporalMentions, parseTemporalExpression } from "./temporal";

export type TaskIntentKind = "direct_assignment" | "family_help" | "health_followup" | "open_volunteer" | "personal_todo" | "task_breakdown";
export type TaskAssigneeScope = "core_family_except_sender" | "health_subject" | "mentioned" | "self";

export type TaskIntent = {
  assigneeScope: TaskAssigneeScope;
  confidence: number;
  displayTime?: string;
  dueAt?: string;
  evidence: string[];
  intent: "task.create";
  options: string[];
  sourceText: string;
  taskActionType: TaskActionType;
  taskKind: TaskIntentKind;
  title: string;
};

export type TaskReminderParseResult = {
  displayTime?: string;
  dueAt?: string;
  sourceText: string;
  title: string;
  isReminder: boolean;
  requiresClarification: boolean;
  recurrence?: TaskRecurrence;
  clarificationMessage?: string;
};

export type TaskIntentContext = {
  contextTab: string;
  mentionedMemberIds: string[];
  senderMemberId: string;
};

export type TaskTimeMention = {
  end: number;
  kind: "absolute" | "recurring" | "relative";
  start: number;
  text: string;
};

export function extractTaskTimeMentions(text: string): TaskTimeMention[] {
  return extractTemporalMentions(text);
}

export function classifyTaskIntent(text: string, context: TaskIntentContext, receivedAt = new Date(), timeZone = "Asia/Shanghai"): TaskIntent {
  const sourceText = text.trim();
  const evidence: string[] = [];
  const reminder = parseTaskReminder(sourceText, receivedAt, timeZone);
  const { displayTime, dueAt } = reminder;

  if (context.mentionedMemberIds.length > 0) {
    evidence.push("manual_mentions");
    return {
      assigneeScope: "mentioned",
      confidence: 0.96,
      displayTime,
      dueAt,
      evidence,
      intent: "task.create",
      options: inferTaskOptions(sourceText, "direct_assignment"),
      sourceText,
      taskActionType: inferTaskActionType(sourceText, "direct_assignment"),
      taskKind: "direct_assignment",
      title: reminder.title || normalizeTaskTitle(sourceText, displayTime)
    };
  }

  if (isOpenVolunteerQuestion(sourceText)) {
    evidence.push("open_volunteer_question");
    return {
      assigneeScope: "core_family_except_sender",
      confidence: 0.88,
      displayTime,
      dueAt,
      evidence,
      intent: "task.create",
      options: ["愿意", "不愿意"],
      sourceText,
      taskActionType: "approval",
      taskKind: "open_volunteer",
      title: reminder.title || normalizeTaskTitle(sourceText, displayTime)
    };
  }

  if (isFamilyHelpRequestText(sourceText)) {
    evidence.push("family_help_request");
    return {
      assigneeScope: "core_family_except_sender",
      confidence: 0.84,
      displayTime,
      dueAt,
      evidence,
      intent: "task.create",
      options: inferTaskOptions(sourceText, "family_help"),
      sourceText,
      taskActionType: inferTaskActionType(sourceText, "family_help"),
      taskKind: "family_help",
      title: normalizeFamilyHelpTaskTitle(sourceText, displayTime)
    };
  }

  if (isHealthFollowupText(sourceText)) {
    evidence.push("health_followup_text");
    return {
      assigneeScope: "health_subject",
      confidence: 0.86,
      displayTime,
      dueAt,
      evidence,
      intent: "task.create",
      options: [],
      sourceText,
      taskActionType: "input",
      taskKind: "health_followup",
      title: normalizeHealthTaskTitle(sourceText, displayTime)
    };
  }

  if (isTaskBreakdownText(sourceText)) {
    evidence.push("task_breakdown_text");
    return {
      assigneeScope: "self",
      confidence: 0.84,
      displayTime,
      dueAt,
      evidence,
      intent: "task.create",
      options: inferTaskOptions(sourceText, "task_breakdown"),
      sourceText,
      taskActionType: "multiple_choice",
      taskKind: "task_breakdown",
      title: normalizeBreakdownTaskTitle(sourceText, displayTime)
    };
  }

  if (context.contextTab === "待办" && !looksFamilyAssigned(sourceText)) {
    evidence.push("personal_todo_tab");
    return {
      assigneeScope: "self",
      confidence: 0.72,
      displayTime,
      dueAt,
      evidence,
      intent: "task.create",
      options: inferTaskOptions(sourceText, "personal_todo"),
      sourceText,
      taskActionType: inferTaskActionType(sourceText, "personal_todo"),
      taskKind: "personal_todo",
      title: reminder.title || normalizeTaskTitle(sourceText, displayTime)
    };
  }

  return {
    assigneeScope: "self",
    confidence: 0.55,
    displayTime,
    dueAt,
    evidence,
    intent: "task.create",
    options: inferTaskOptions(sourceText, "direct_assignment"),
    sourceText,
    taskActionType: inferTaskActionType(sourceText, "direct_assignment"),
    taskKind: "direct_assignment",
    title: reminder.title || normalizeTaskTitle(sourceText, displayTime)
  };
}

export function isHealthFollowupText(text: string) {
  const normalized = normalizeInput(text);
  return (
    (/(健康|身体|不舒服|难受|头晕|发烧|咳嗽|疼|痛|血压|血糖|心率|体温|睡眠|失眠|过敏|医院|复查|复测|体检|吃药|药|基础病|慢性病)/.test(normalized) &&
      /(提醒|记录|复查|复测|观察|跟进|安排|预约|明天|今天|下周|结果|报告|注意)/.test(normalized)) ||
    isLightHealthStatus(normalized)
  );
}

function isLightHealthStatus(text: string) {
  // 问原因、求建议属于聊天，不把它误判成健康跟进任务。
  if (/(为什么|为何|怎么|怎样|如何|吗|么|\?|？)/.test(text)) {
    return false;
  }
  return /(我|本人|自己|爸爸|老爸|妈妈|老妈|老婆|姐姐|儿子|闺女|女儿|豆包|饭米粒).*(累|疲惫|疲劳|没精神|乏力|困|撑不住|不太舒服)/.test(text);
}

export function shouldSuggestTaskFromText(text: string, context: TaskIntentContext) {
  const normalized = normalizeInput(text);
  if (isTaskQueryText(normalized) || isConversationalAdviceRequest(normalized) || isNegatedTaskRequest(normalized)) {
    return false;
  }
  if (isCasualChatText(normalized) && !isExplicitTaskCommand(normalized)) {
    return false;
  }

  const intent = classifyTaskIntent(normalized, context);

  if (isTimedTaskStatement(normalized)) {
    return true;
  }

  if (
    (intent.taskKind === "family_help" && isExplicitFamilyHelpRequest(normalized)) ||
    (intent.taskKind === "health_followup" && isExplicitTaskCommand(normalized)) ||
    (intent.taskKind === "open_volunteer" && isExplicitCoordinationRequest(normalized)) ||
    (intent.taskKind === "personal_todo" && isExplicitTaskCommand(normalized)) ||
    (intent.taskKind === "task_breakdown" && isExplicitTaskCommand(normalized))
  ) {
    return true;
  }

  if (context.mentionedMemberIds.length > 0 && isExplicitTaskCommand(normalized)) {
    return true;
  }

  if (isCasualChatText(normalized)) {
    return false;
  }

  return isExplicitTaskCommand(normalized);
}

export function isAmbiguousOrganizationRequest(text: string) {
  const normalized = normalizeInput(text)
    .replace(/^(?:请|麻烦|帮我|给我)\s*/, "")
    .replace(/[。.!！?？]+$/, "")
    .trim();
  if (!normalized) {
    return false;
  }
  return /^(?:整理|梳理)(?:一下|下)?(?:今天|今日|本周|这周|本月|这个月)(?:的?(?:记录|事情|内容|动态|情况|生活|日程|待办|任务))?$/.test(normalized) ||
    /^(?:今天|今日|本周|这周|本月|这个月)(?:的?(?:记录|事情|内容|动态|情况|生活|日程|待办|任务))?(?:整理|梳理)(?:一下|下)?$/.test(normalized);
}

export function isTimedTaskStatement(text: string) {
  const normalized = normalizeInput(text);
  const timeMentions = extractTaskTimeMentions(normalized);
  if (!normalized || timeMentions.length === 0) {
    return false;
  }
  if (/[?？]$/.test(normalized) || /呢$/.test(normalized) || /(几点|什么时候|怎么|怎样|如何|为什么|为啥|是否|吗|么)/.test(normalized)) {
    return false;
  }
  if (/(?:总结|汇总|复盘)/.test(normalized)) {
    return false;
  }
  if (isAmbiguousOrganizationRequest(normalized)) {
    return false;
  }
  if (isAmbientConditionStatement(normalized) && !isExplicitTaskCommand(normalized)) {
    return false;
  }
  if (/(感觉|觉得|心情|天气|气温|温度|开心|焦虑|难受|有点累|很累|好累|累死|有意思|好看|放松|开心|高兴)/.test(normalized)) {
    return false;
  }
  if (/(?:联网搜索|网络搜索|上网查|搜索|搜一下)|(?:家里|家庭).{0,12}(?:有哪些人|成员|在线)|(?:App|软件).{0,12}(?:怎么|如何|功能|使用)/i.test(normalized)) {
    return false;
  }
  if (/(?:昨天|前天)/.test(normalized)) {
    return false;
  }
  if (/(分解|拆解|拆成|分成|列步骤|列一下).*(准备|计划|任务|事项)?/.test(normalized)) {
    return false;
  }
  if (/(去了|吃了|喝了|做完了|完成了|看到了|已经|刚刚|刚才)/.test(normalized)) {
    return false;
  }
  if (isNegatedTaskRequest(normalized)) {
    return false;
  }

  // 时间只是任务的一个实体，不等于用户已经发出了任务指令。家庭聊天里
  // “明晚我加班”“老婆明天去医院”首先是上下文事实，不能仅因出现日期
  // 就打断对话并弹出任务卡；但“三点”“十点吧”这类精确时间仍可作为
  // 已有任务候选的补充。
  const withoutTime = timeMentions
    .reduce((content, mention) => content.replace(mention.text, " "), normalized)
    .replace(/[，,。.!！?？：:\s]/g, "")
    .replace(/^(?:就|是|定在|改成|安排在)/, "")
    .replace(/[吧呀啊呢]+$/, "")
    .trim();
  const hasPreciseClock = timeMentions.some((mention) => /(?:\d{1,2}|[一二两三四五六七八九十]+)\s*(?:点|时)|[:：]\d{2}/.test(mention.text));
  if (!withoutTime) {
    return hasPreciseClock;
  }

  const contextualStatus =
    /(?:我|他|她|爸爸|老爸|妈妈|老妈|老婆|姐姐|儿子|闺女|女儿).{0,10}(?:加班|上班|上学|放假|出差|回家|回来|去医院|去复查|有课|考试|考砸|血压|血糖)/.test(normalized) ||
    /(?:血压|血糖|体温|考试|数学|高铁).{0,10}(?:高|低|没买|还没|考砸|不及格)/.test(normalized) ||
    /(?:周末|明天|后天|今晚|上午|下午|晚上).{0,6}(?:回家|回来|可能|也许|大概)/.test(normalized);
  const hasExplicitAssignee = /@[^\s，,。.!！?？]{1,12}|(?:让|叫|安排|派给|分配给|负责)/.test(normalized);
  const hasExecutablePredicate = /(?:打车|开车|订票|买|拿|取|送|接|整理|打扫|收拾|检查|关窗|关门|交费|缴费)/.test(normalized);
  const unfinishedStatus = /(?:还没|没有|没买|尚未|未买)/.test(normalized);
  if (contextualStatus && !isExplicitTaskCommand(normalized) && !hasExplicitAssignee && (!hasExecutablePredicate || unfinishedStatus)) {
    return false;
  }

  return true;
}

function isNegatedTaskRequest(text: string) {
  const normalized = text.toLowerCase();
  const negativeBeforeAction =
    /(?:不|别|不要|不用|不必|取消|撤销).{0,8}(?:叫|喊|提醒|记得|待办|任务|安排|买|拿|取|送|接|做|吃|喝|去|来|出门|起床|开会)/.test(
      normalized
    );
  const negativePredicate =
    /不(?:想|会|要|去|来|做|吃|喝|买|拿|取|送|接|起|出门|开会)|也不(?:去|来|做|起|出门)|(?:^|\s)(?:not|no|cancel)(?:\s|$)/i.test(
      normalized
    );
  const negativeCorrection =
    /^(?:不是|并非|not)\s*(?:今天|明天|后天|周末|早上|上午|下午|晚上|今晚|(?:\d{1,2}|[一二两三四五六七八九十]+)\s*(?:点|:|：))/.test(normalized);
  return negativeBeforeAction || negativePredicate || negativeCorrection;
}

/**
 * 任务候选只接受清晰的创建/提醒/分配指令。不要用“帮我”“处理”“计划”等
 * 单词兜底，否则普通咨询会在聊天入口被错误拦截。
 */
export function isExplicitTaskCommand(text: string) {
  const normalized = normalizeInput(text);
  return (
    /(?:添加|新增|创建|新建|设定|设置|列入|加入|生成).{0,8}(?:任务|待办|提醒|事项|计划)/.test(normalized) ||
    /(?:提醒我|帮我提醒|设(?:个|一下)?提醒|加入待办|记到待办|添加任务|新建任务|创建任务|列为任务|安排给|分配给|派给)/.test(normalized) ||
    /(?:记得|提醒).{0,16}(?:买|做|去|看|复查|复测|预约|接|送|拿|取|出门)/.test(normalized)
  );
}

function isExplicitCoordinationRequest(text: string) {
  return /(?:谁|大家|有没有人|有谁).*(?:愿意|可以|能|有空).*(?:一起|帮忙|做|去|陪)/.test(text);
}

function isExplicitFamilyHelpRequest(text: string) {
  return /(帮我|给我|麻烦|能不能|可不可以).*(做饭|带饭|点餐|买饭|买菜|买药|倒水|接我|送我|拿一下|取一下|准备吃的|弄点吃的|照看|陪一下)/.test(text);
}

function isConversationalAdviceRequest(text: string) {
  return (
    /(?:怎么|怎样|如何).*(?:安排|说|沟通|表达|处理|回复|开口)/.test(text) ||
    /(?:为什么|为何).*(?:累|烦|难受|焦虑|不开心|低落)/.test(text) ||
    /(?:适不适合|适合不适合|要不要).*(?:换工作|离职|辞职)/.test(text) ||
    /(?:吵架|关系|同事|项目).*(?:怎么办|怎么说|怎么处理|怎么沟通)/.test(text)
  );
}

function isTaskQueryText(text: string) {
  return (
    /(谁|哪位|哪些|哪个|多少|有没有|有谁|了吗|了没|是什么|怎么回事).*(任务|待办)/.test(text) ||
    /(任务|待办).*(谁|哪位|哪些|哪个|多少|有没有|有谁|了吗|了没|是什么|怎么回事)/.test(text) ||
    /谁.*(给我|向我|帮我).*(派|指派|安排|发起).*(任务|待办)/.test(text) ||
    /(派给我|给我的|我需要处理).*(任务|待办).*(谁|哪些|有吗|了吗|多少)?/.test(text)
  );
}

export function isCasualChatText(text: string) {
  const normalized = normalizeInput(text);
  return (
    /^(你好|嗨|hi|hello|早安|晚安|在吗|哈哈|哈哈哈|嘿嘿|谢谢|谢了|没事|随便聊聊|聊会儿|陪我聊聊)/i.test(normalized) ||
    /(怎么样|好玩吗|真不错|挺好|有意思|开心|难过|无聊|想聊天|聊聊天)/.test(normalized) ||
    isAmbientConditionStatement(normalized)
  );
}

export function isAmbientConditionStatement(text: string) {
  const normalized = normalizeInput(text).replace(/[。.!！]+$/, "");
  return (
    /(?:^|今天|今晚|今早|明天|明晚|现在)(?:可|也|还是)?(?:真|太|好|挺|有点|特别|格外)?(?:热|冷|闷|潮湿|干燥|凉快|晒)(?:了|啊|呀|呢|死了|得慌)?$/.test(normalized) ||
    /(?:^|今天|今晚|今早|明天|明晚|现在)(?:可能|也许|大概)?(?:下雨|下雪|刮风|雨(?:真|太|很|好)?大|风(?:真|太|很|好)?大)(?:了|啊|呀|呢)?$/.test(normalized)
  );
}

export function isOpenVolunteerQuestion(text: string) {
  const normalized = normalizeInput(text);
  return (
    /谁(愿意|想|可以|能|有空)/.test(normalized) ||
    /有没有人/.test(normalized) ||
    /大家.*(愿意|想|可以|能|有空)/.test(normalized) ||
    /(?:谁|有谁).*(跟我|和我|给我|陪我).*(一起|一块)/.test(normalized) ||
    /(?:谁|有谁).*(一起|一块).*(吃饭|打球|爬山|跑步|露营|去|做)/.test(normalized)
  );
}

export function isFamilyHelpRequestText(text: string) {
  const normalized = normalizeInput(text);
  return (
    /(我|本人|自己|这边).*(饿了|肚子饿|没吃饭|还没吃|想吃|想喝|渴了|口渴|冷了|热了|不舒服|难受|头晕|发烧|疼|痛)/.test(normalized) ||
    /(帮我|给我|需要|麻烦|能不能|可不可以).*(做饭|带饭|点餐|买饭|买菜|买药|倒水|接我|送我|拿一下|取一下|准备吃的|弄点吃的|照看|陪一下)/.test(normalized) ||
    /(家里|家庭|有人|谁|有谁).*(可以|能|有空|方便).*(帮忙|做饭|买药|接送|照看|倒水|带饭)/.test(normalized)
  );
}

export function isTaskBreakdownText(text: string) {
  const normalized = normalizeInput(text);
  return /(拆解|分解|拆成|分成|拆一下|分一下|列一下|列出|步骤|计划)/.test(normalized) && /(任务|待办|安排|准备|流程|步骤|计划|事项|清单|怎么做|如何做)/.test(normalized);
}

export function inferTaskActionType(text: string, taskKind: TaskIntentKind = "direct_assignment"): TaskActionType {
  if (taskKind === "open_volunteer" || isOpenVolunteerQuestion(text)) {
    return "approval";
  }

  if (taskKind === "family_help" || isFamilyHelpRequestText(text)) {
    return "approval";
  }

  if (taskKind === "health_followup" || isHealthFollowupText(text)) {
    return "input";
  }

  if (taskKind === "task_breakdown" || isTaskBreakdownText(text)) {
    return "multiple_choice";
  }

  if (/哪几|哪些|选择|多选|分配|区域|清单|选一下/i.test(text)) {
    return "multiple_choice";
  }

  if (/是不是|是否|能不能|可不可以|要不要|同意|确认|可以吗|\?$|？$|agree|ok/i.test(text)) {
    return "approval";
  }

  return "input";
}

export function inferTaskOptions(text: string, taskKind: TaskIntentKind = "direct_assignment") {
  if (taskKind === "open_volunteer" || isOpenVolunteerQuestion(text)) {
    return ["愿意", "不愿意"];
  }

  if (taskKind === "family_help" || isFamilyHelpRequestText(text)) {
    if (/(饿了|肚子饿|没吃饭|还没吃|想吃|做饭|带饭|点餐|买饭|准备吃的|弄点吃的)/.test(text)) {
      return ["可以帮忙", "帮忙点餐", "稍后处理"];
    }
    if (/(渴了|口渴|想喝|倒水)/.test(text)) {
      return ["可以倒水", "稍后处理"];
    }
    if (/(接我|送我|接送)/.test(text)) {
      return ["可以接送", "稍后确认"];
    }
    return ["可以帮忙", "稍后处理"];
  }

  if (taskKind === "task_breakdown" || isTaskBreakdownText(text)) {
    const breakdownOptions = extractBreakdownOptions(text);
    return breakdownOptions.length >= 2 ? breakdownOptions : ["先列步骤", "分配负责人", "确认完成时间"];
  }

  if (!/哪几|哪些|选择|多选|分配|区域|清单|选一下/i.test(text)) {
    return [];
  }

  if (/清洁|打扫|扫除|床单|洗|区域/i.test(text)) {
    return ["客厅", "厨房", "卫生间", "卧室"];
  }

  return ["我来处理", "需要别人帮忙", "稍后确认"];
}

export function normalizeTaskTitle(text: string, displayTime = extractTaskDisplayTime(text)) {
  const cleaned = cleanTaskTitleTime(text.replace(/^[@\s/]+/, "").replace(/[。？！?!.]+$/, ""), displayTime);
  return compactExplicitFamilyAssignment(stripTaskCommandPrefix(cleaned)).slice(0, 24) || "新的待办";
}

function compactExplicitFamilyAssignment(title: string) {
  const match = title.match(/^(?:让|叫|请)\s*(老妈|妈妈|母亲|妈|爸爸|老爸|父亲|爸|老婆|媳妇|妻子|姐姐|姐|儿子|闺女|女儿)\s*(?:来)?\s*给我\s*(.+)$/);
  if (!match) return title;
  const action = match[2]
    .replace(/^(?:帮忙|帮我)\s*/, "")
    .replace(/[吧呀啊呢]+$/, "")
    .trim();
  return action ? `${match[1]}${action}` : title;
}

export function parseTaskReminder(text: string, receivedAt = new Date(), timeZone = "Asia/Shanghai"): TaskReminderParseResult {
  const sourceText = text.trim();
  const parsedTime = parseTemporalExpression(sourceText, receivedAt, timeZone, "reminder");
  const withoutTime = parsedTime.matchedText ? sourceText.replace(parsedTime.matchedText, " ") : sourceText;
  const title = normalizeReminderTitle(withoutTime);
  const isReminder = /^(?:到时候\s*)?(?:请|麻烦)?\s*(?:帮我\s*)?(?:记得\s*)?(?:提醒|通知|设(?:置)?(?:个|一个|一下)?提醒|加(?:入|到)?待办|加入任务|记(?:到|入)待办)/.test(withoutTime.trim());
  return {
    displayTime: parsedTime.displayText,
    dueAt: parsedTime.instant,
    sourceText,
    title,
    isReminder,
    recurrence: parsedTime.recurrence,
    requiresClarification: !title || parsedTime.requiresClarification,
    clarificationMessage: parsedTime.clarificationMessage || (!title ? "你希望我提醒你做什么？请补充具体事项。" : undefined)
  };
}

function stripTaskCommandPrefix(text: string) {
  let title = text.trim();
  const reverseCommand = title.match(/^(?:把\s*)?(.+?)\s*(?:添加|新增|创建|新建|设为|记为|加入)\s*(?:成|为)?\s*(?:一(?:个|条)|个|条)?\s*(?:任务|待办|事项|提醒)$/);
  if (reverseCommand?.[1]) {
    title = reverseCommand[1].trim();
  } else {
    title = title.replace(
      /^(?:(?:帮我|请|麻烦|给我)\s*)?(?:(?:添加|新增|创建|新建|建立|安排|记录|设为|加入|加)\s*)?(?:(?:一(?:个|条)|个|条)\s*)?(?:任务|待办|事项|提醒)(?:\s*(?:是|为|叫|标题是|标题为))?[\s:：，,]*/,
      ""
    );
  }

  return title
    .replace(/^(?:帮我|请|麻烦|给我)\s*/, "")
    .replace(/^(?:我|我们)(?=(?:去|买|做|看|整理|准备|联系|预约|提交|完成|处理|学习|锻炼|打扫|洗|收拾))/, "")
    .replace(/[吧呀啊呢]+$/, "")
    .trim();
}

function normalizeReminderTitle(text: string) {
  let title = text.replace(/[。？！?!.]+$/, "").replace(/\s+/g, " ").trim();
  title = title
    .replace(/^(?:到时候\s*)?(?:请|麻烦)?\s*(?:帮我\s*)?(?:记得\s*)?(?:提醒|通知)\s*我(?:\s*一下)?\s*/, "")
    .replace(/^(?:到时候\s*)?(?:请|麻烦)?\s*(?:记得\s*)?(?:提醒|通知)\s*(?:一下\s*)?((?!我)[^\s，,]{1,8})\s*/, "$1")
    .replace(/^(?:请|麻烦)?\s*(?:帮我\s*)?(?:设(?:置)?(?:个|一个|一下)?提醒|加(?:入|到)?待办|加入任务|记(?:到|入)待办)\s*(?:提醒我\s*)?/, "")
    .replace(/^(?:我)?\s*(?:要|需要)?\s*/, "")
    .replace(/^(?:一下|一声)\s*/, "")
    .trim();
  return title.slice(0, 24);
}

function normalizeHealthTaskTitle(text: string, displayTime = extractTaskDisplayTime(text)) {
  const cleanedText = cleanTaskTitleTime(text, displayTime);
  const matchedMember = cleanedText.match(/(老妈|妈妈|母亲|妈|爸爸|老爸|父亲|爸|老婆|媳妇|妻子|姐姐|姐|儿子|闺女|女儿|小明|饭米粒)/)?.[1];
  const subject = matchedMember ? `${matchedMember}` : "家人";
  return `${subject}健康跟进`;
}

function normalizeBreakdownTaskTitle(text: string, displayTime = extractTaskDisplayTime(text)) {
  const title = cleanTaskTitleTime(text, displayTime)
    .replace(/^(帮我|请|麻烦)?/, "")
    .replace(/(拆解|分解|拆成|分成|拆一下|分一下|列一下|列出|步骤|计划).*/, "")
    .replace(/[，,。.!！?？]+$/, "")
    .trim();
  return `${(title || "任务").slice(0, 18)}拆解`;
}

function normalizeFamilyHelpTaskTitle(text: string, displayTime = extractTaskDisplayTime(text)) {
  const cleanedText = cleanTaskTitleTime(text, displayTime);
  if (/(饿了|肚子饿|没吃饭|还没吃|想吃|做饭|带饭|点餐|买饭|准备吃的|弄点吃的)/.test(cleanedText)) {
    return "帮我准备吃的";
  }
  if (/(渴了|口渴|想喝|倒水)/.test(cleanedText)) {
    return "帮我准备喝的";
  }
  if (/(接我|送我|接送)/.test(cleanedText)) {
    return "帮我安排接送";
  }
  if (/(买药|药)/.test(cleanedText)) {
    return "帮我买药";
  }
  return normalizeTaskTitle(cleanedText, displayTime);
}

function extractTaskDisplayTime(text: string) {
  return parseTemporalExpression(text, new Date(), "Asia/Shanghai", "record").displayText;
}

function cleanTaskTitleTime(title: string, displayTime?: string) {
  if (!displayTime) {
    return title.trim();
  }

  return (
    title
      .replace(displayTime, "")
      .replace(/\s+/g, " ")
      .replace(/^(今天|明天|后天|周末|本周|下周|这周|下星期)(?=\S)/, "")
      .replace(/^(早上|上午|中午|下午|晚上|今晚|夜里)(?=\S)/, "")
      .trim() || title.trim()
  );
}

function extractBreakdownOptions(text: string) {
  const match = text.match(/(?:拆解成|分解成|拆成|分成|包括|包含|有)(.+)$/);
  const listText = match?.[1]?.replace(/[。.!！?？]+$/, "").trim();
  if (!listText) {
    return [];
  }

  return listText
    .split(/[、，,；;\/\n]+/)
    .map((item) => item.replace(/^(和|以及|还有|再)?/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function looksFamilyAssigned(text: string) {
  return /爸爸|老爸|妈妈|老妈|老婆|媳妇|姐姐|儿子|闺女|女儿|家庭|家里|大家|所有人|@/.test(text);
}

function normalizeInput(text: string) {
  return text.trim().replace(/^\/+/, "").trim();
}
