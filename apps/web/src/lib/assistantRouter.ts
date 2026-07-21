import {
  automationActions,
  getAutomationAction,
  matchAutomationUnit,
  type AutomationActionDefinition,
  type AutomationActionId,
  type AutomationPipelineId,
  type AutomationUnitDefinition
} from "./automationRegistry";
import { detectDangerousOperation } from "./safetyGuard";
import type { FamilyMember } from "./types";
import type { AutomationDisplayTarget, AutomationDisplayType } from "./automations";
import { isAmbientConditionStatement, isSummaryRequestText, isTimedTaskStatement } from "./taskIntent";
import { parseTemporalExpression } from "./temporal";

export type AssistantDialogueState = {
  activeQueryType?: AppAnswerQueryType;
  recordDate?: string;
  remainingFollowUps: number;
};

export type AssistantConversationTurn = {
  role: "assistant" | "user";
  text: string;
};

export type ContextualGroupPlan = {
  details: {
    date: string;
    food: string | null;
    location: string | null;
    time: string | null;
  };
  memberIds: string[];
  message: string;
  missingFields: Array<"food" | "location" | "time">;
  title: string;
};

export type FamilyQuestionPlan = {
  dateLabel: string | null;
  knowledgeInquiryId?: string;
  memberIds: string[];
  message: string;
  question: string;
  title: string;
};

export type MemberKnowledgeQueryPlan = {
  memberId: string;
  memberName: string;
  question: string;
};

export type AssistantRoute =
  | {
      kind: "pipeline";
      id: AutomationPipelineId;
      parameters: {
        text: string;
      };
    }
  | {
      kind: "action";
      id: AutomationActionId;
      parameters: {
        member?: string;
        memberId?: string;
        newName?: string;
        queryType?: AppAnswerQueryType;
        recordDate?: string;
        groupPlan?: ContextualGroupPlan;
        familyQuestionPlan?: FamilyQuestionPlan;
        text: string;
      };
    }
  | {
      kind: "automation";
      unit: AutomationUnitDefinition;
      parameters: {
        text: string;
      };
    }
  | {
      kind: "fallback";
      clarification?: AssistantClarification;
      reason: "assignment_or_search";
      focusText?: string;
      suggestedAction?: "memory.save" | "task.create.input";
    };

export type AppAnswerQueryType =
  | "api.usage"
  | "app.capabilities"
  | "system.time"
  | "system.date"
  | "members.count"
  | "members.list"
  | "members.online"
  | "profiles.available"
  | "tasks.outgoing"
  | "tasks.incoming"
  | "tasks.pending"
  | "tasks.help"
  | "resources.list"
  | "records.recent"
  | "unknown";

export type AssistantRouteContext = {
  actorMemberId?: string;
  actorName?: string;
  dialogueState?: AssistantDialogueState;
  recentConversation?: AssistantConversationTurn[];
  recentUserTexts?: string[];
};

export type AssistantRouterIntent =
  | "web.search"
  | "task.create"
  | "task.suggest"
  | "group.chat"
  | "local.answer"
  | "casual.chat"
  | "clarify";

export type RouteIntent =
  | "daily_log"
  | "task"
  | "reminder"
  | "knowledge"
  | "app_answer"
  | "app_chat"
  | "group_chat"
  | "web_search"
  | "profile_describe"
  | "invite"
  | "summary_request"
  | "dangerous"
  | "ambiguous";

export type AssistantRouteActionButton = {
  label: string;
  queryText?: string;
  value: "save_record" | "create_task" | "save_knowledge" | "continue_chat" | "search_web" | "app_help" | "ask_member" | "provide_input" | "dismiss" | "go_back" | "revise_input";
};

export type AssistantClarification = {
  familyQuestionPlan?: FamilyQuestionPlan;
  id: string;
  knowledgeInquiryId?: string;
  memberName?: string;
  options: AssistantRouteActionButton[];
  originalText: string;
  parentId?: string;
  previous?: AssistantClarification;
  selectedPath?: Array<{
    label: string;
    value: AssistantRouteActionButton["value"];
  }>;
  prompt: string;
  round: number;
};

export type AssistantRouteContract = {
  actionButtons: AssistantRouteActionButton[];
  candidateActions: AutomationActionId[];
  confidence: number;
  displayTarget: AutomationDisplayTarget;
  displayType: AutomationDisplayType;
  entities: Record<string, unknown>;
  intent: RouteIntent[];
  reason: string;
  requiresConfirmation: boolean;
  summary: string;
};

export type ValidateAssistantRouteCandidateResult =
  | {
      ok: true;
      route: AssistantRouteContract;
    }
  | {
      ok: false;
      route: AssistantRouteContract;
      reason: "invalid_json" | "invalid_intent" | "invalid_schema" | "low_confidence";
    };

export type RouteIntentPromptInput = {
  actorName: string;
  candidateActions: AutomationActionDefinition[];
  currentDate: string;
  familyMembers: FamilyMember[];
  recentContext: string;
  userInput: string;
};

const memberAliasGroups: Record<string, string[]> = {
  dad: ["爸爸", "老爸", "父亲", "爸"],
  daughter: ["闺女", "女儿", "姑娘", "孩子女儿"],
  fanmili: ["小饭大人", "饭米粒", "小范大人", "豆包", "家庭助手", "助手"],
  me: ["小明", "我自己", "本人", "我"],
  mom: ["老妈", "妈妈", "母亲", "妈", "老娘"],
  sister: ["姐姐", "老姐", "姐"],
  son: ["儿子", "孩子儿子", "男孩"],
  wife: ["老婆", "媳妇", "妻子", "太太", "爱人"]
};

export function routeAssistantInput(text: string, members: FamilyMember[], context: AssistantRouteContext = {}): AssistantRoute {
  const rawNormalized = normalizeInput(text);

  if (!rawNormalized) {
    return {
      kind: "fallback",
      reason: "assignment_or_search"
    };
  }

  const dangerousOperation = detectDangerousOperation(rawNormalized);
  if (dangerousOperation) {
    return {
      kind: "action",
      id: "safety.dangerous_operation",
      parameters: {
        text: rawNormalized
      }
    };
  }
  const normalized = stripCorrectionPrefix(rawNormalized);

  const contextualGroupPlan = resolveContextualGroupPlan(normalized, members, context);
  if (contextualGroupPlan) {
    return {
      kind: "action",
      id: "group.organize.contextual",
      parameters: {
        groupPlan: contextualGroupPlan,
        text: normalized
      }
    };
  }
  const contextualGroupClarification = buildContextualGroupDateClarification(normalized, context);
  if (contextualGroupClarification) {
    return {
      kind: "fallback",
      clarification: contextualGroupClarification,
      reason: "assignment_or_search"
    };
  }

  const memberKnowledgePlan = resolveMemberKnowledgeQueryPlan(normalized, members, context);
  if (memberKnowledgePlan) {
    return {
      kind: "action",
      id: "member.knowledge.resolve",
      parameters: {
        member: memberKnowledgePlan.memberName,
        memberId: memberKnowledgePlan.memberId,
        text: memberKnowledgePlan.question
      }
    };
  }

  const familyQuestionPlan = resolveFamilyQuestionPlan(normalized, members, context);
  if (familyQuestionPlan) {
    return {
      kind: "action",
      id: "group.ask.family",
      parameters: {
        familyQuestionPlan,
        text: normalized
      }
    };
  }

  const focusText = selectAssistantRoutingFocus(normalized);
  if (focusText !== normalized) {
    return applyLongInputFocus(routeAssistantInput(focusText, members, context), normalized, focusText);
  }

  if (isExplicitNoActionRequest(normalized)) {
    return {
      kind: "action",
      id: "app.chat",
      parameters: { text: normalized }
    };
  }

  if (isExplicitlyUncertainRequest(normalized)) {
    return {
      kind: "fallback",
      clarification: buildAssistantClarification(normalized),
      reason: "assignment_or_search"
    };
  }

  const inviteMember = extractInviteMemberQuery(normalized, members);
  if (inviteMember) {
    return {
      kind: "action",
      id: "invite.create",
      parameters: {
        member: inviteMember,
        text: normalized
      }
    };
  }

  if (isProfileLearningRequest(normalized)) {
    return {
      kind: "pipeline",
      id: "pipeline.meta.profile_learning",
      parameters: {
        text: normalized
      }
    };
  }

  const summaryActionId = extractDeepSummaryActionId(normalized);
  if (summaryActionId) {
    return {
      kind: "action",
      id: summaryActionId,
      parameters: {
        text: normalized
      }
    };
  }

  const memberRename = extractMemberRenameIntent(normalized, members);
  if (memberRename) {
    return {
      kind: "action",
      id: "member.rename",
      parameters: {
        member: memberRename.memberName,
        newName: memberRename.newName,
        text: normalized
      }
    };
  }

  const contextualRoute = resolveConfirmedContextualWrite(normalized, context);
  if (contextualRoute) {
    return contextualRoute;
  }

  if (isKnowledgeSaveCandidate(normalized, members)) {
    return {
      kind: "action",
      id: "memory.save",
      parameters: {
        text: normalized
      }
    };
  }

  // “今天太热了”这类时间背景只是家常聊天。必须在任何提醒/分配
  // 兜底之前截住，避免仅凭“今天”弹出一个过期提醒。
  if (isAmbientConditionStatement(normalized)) {
    return {
      kind: "action",
      id: "app.chat",
      parameters: { text: normalized }
    };
  }

  // A concrete local date/time is enough to offer a task confirmation card.
  // Keep this before profile/member clarifications so "明天 @爸爸 ..." does
  // not drift into chat or model routing.
  if (isTimedTaskStatement(normalized)) {
    return {
      kind: "fallback",
      focusText: normalized,
      reason: "assignment_or_search",
      suggestedAction: "task.create.input"
    };
  }

  const appAnswerQueryType = classifyAppAnswerQuery(normalized);
  if (appAnswerQueryType !== "unknown") {
    const recordDate = appAnswerQueryType === "records.recent" ? readRecordDate(normalized) : undefined;
    return {
      kind: "action",
      id: "app.answer",
      parameters: {
        queryType: appAnswerQueryType,
        recordDate,
        text: normalized
      }
    };
  }

  const profileMemberQuery = extractProfileMemberQuery(normalized, members);
  if (profileMemberQuery) {
    return {
      kind: "action",
      id: "profile.describe",
      parameters: {
        member: profileMemberQuery,
        text: normalized
      }
    };
  }

  const assigneeChoice = buildAssigneeChoiceClarification(normalized, members, context);
  if (assigneeChoice) {
    return {
      kind: "fallback",
      clarification: assigneeChoice,
      reason: "assignment_or_search"
    };
  }

  const familyOccasion = buildFamilyOccasionClarification(normalized, members);
  if (familyOccasion) {
    return {
      kind: "fallback",
      clarification: familyOccasion,
      reason: "assignment_or_search"
    };
  }

  if (
    isExplicitNoActionRequest(normalized) ||
    isConversationContextQuestion(normalized) ||
    isFamilyKnowledgeRecallQuestion(normalized) ||
    isTaskStateStatement(normalized)
  ) {
    return {
      kind: "action",
      id: "app.chat",
      parameters: {
        text: normalized
      }
    };
  }

  if (isWebSearchRequest(normalized)) {
    return {
      kind: "action",
      id: "web.search.duckduckgo",
      parameters: {
        text: normalized
      }
    };
  }

  if (isReminderCreationRequest(normalized)) {
    return {
      kind: "fallback",
      reason: "assignment_or_search",
      suggestedAction: "task.create.input"
    };
  }

  if (isAssignmentTaskRequest(normalized, members)) {
    return {
      kind: "fallback",
      focusText: normalized,
      reason: "assignment_or_search",
      suggestedAction: "task.create.input"
    };
  }

  // A fresh task/reminder statement must win over a previous record-query topic.
  // Only use the record dialogue state after the current turn has had a chance
  // to establish its own actionable intent.
  const contextualAppAnswer = resolveContextualAppAnswer(normalized, context);
  if (contextualAppAnswer) {
    return contextualAppAnswer;
  }

  if (isWeatherQuestionRequest(normalized)) {
    return {
      kind: "action",
      id: "app.chat",
      parameters: {
        text: normalized
      }
    };
  }

  if (isDailyLifeLogRequest(normalized)) {
    return {
      kind: "action",
      id: "app.chat",
      parameters: {
        text: normalized
      }
    };
  }

  if (isUnconfirmedPersonalFactStatement(normalized)) {
    return {
      kind: "action",
      id: "app.chat",
      parameters: { text: normalized }
    };
  }

  if (isCasualConversationRequest(normalized)) {
    return {
      kind: "action",
      id: "app.chat",
      parameters: {
        text: normalized
      }
    };
  }

  if (isShortContextContinuation(normalized, context)) {
    return {
      kind: "action",
      id: "app.chat",
      parameters: { text: normalized }
    };
  }

  const automationUnit = matchAutomationUnit(normalized);
  if (automationUnit) {
    return {
      kind: "automation",
      unit: automationUnit,
      parameters: {
        text: normalized
      }
    };
  }

  return {
    kind: "fallback",
    clarification: buildAssistantClarification(normalized),
    reason: "assignment_or_search"
  };
}

export function buildAssistantClarification(text: string, round = 1): AssistantClarification | undefined {
  const normalized = normalizeInput(text);
  if (!normalized || round > 2 || (!/[?？]/.test(normalized) && normalized.length < 12)) {
    return undefined;
  }
  const options: AssistantRouteActionButton[] = [];
  const add = (option: AssistantRouteActionButton) => {
    if (!options.some((item) => item.value === option.value)) options.push(option);
  };
  const rejectsTask = /(?:不要|不用|别|取消|无需).{0,8}(?:任务|待办|提醒|创建)/.test(normalized);
  const rejectsSaving = /(?:不要|不用|别|取消|无需).{0,8}(?:保存|记住|记下|资料)/.test(normalized);
  if (isWebSearchRequest(normalized)) add({ label: "联网查一下", value: "search_web" });
  if (classifyAppAnswerQuery(normalized) !== "unknown" || /(?:app|软件|功能|怎么用)/i.test(normalized)) {
    add({ label: "问 App 功能", value: "app_help" });
  }
  if (!rejectsTask && (isReminderCreationRequest(normalized) || /(?:任务|待办|提醒|安排)/.test(normalized))) {
    add({ label: "整理成任务", value: "create_task" });
  }
  if (!rejectsSaving && /(?:记住|记下|保存|存一下|长期|资料)/.test(normalized)) {
    add({ label: "保存为资料", value: "save_knowledge" });
  }
  add({ label: "直接聊这个", value: "continue_chat" });
  if (options.length === 1 && !rejectsTask && !rejectsSaving) {
    add({ label: "整理成任务", value: "create_task" });
    add({ label: "保存为资料", value: "save_knowledge" });
  }
  return {
    id: `clarify-${simpleTextHash(normalized)}-${round}`,
    options: options.slice(0, 3),
    originalText: normalized,
    prompt: "我大概明白了，但还不确定你想让我怎么处理：",
    round
  };
}

function buildAssigneeChoiceClarification(
  text: string,
  members: FamilyMember[],
  context: AssistantRouteContext
): AssistantClarification | undefined {
  if (!/(?:提醒|任务|待办|安排|负责|处理|去做|来做)/.test(text)) return undefined;
  const separator = findAlternativeSeparator(text);
  if (!separator) return undefined;

  const leftText = text.slice(0, separator.index);
  const rightText = text.slice(separator.index + separator.value.length);
  const segmentSpeaker = findSegmentSpeaker(leftText, members);
  const scopedContext = segmentSpeaker
    ? { ...context, actorMemberId: segmentSpeaker.id, actorName: segmentSpeaker.displayName }
    : context;
  const left = findMemberReference(leftText, members, scopedContext, "last");
  const right = findMemberReference(rightText, members, scopedContext, "first");
  if (!left || !right || left.member.id === right.member.id) return undefined;

  const subject = compactAssigneeChoiceSubject(
    `${leftText.slice(0, left.index)} ${leftText.slice(left.index + left.alias.length)} ${rightText.slice(0, right.index)} ${rightText.slice(right.index + right.alias.length)}`
  );
  const taskSubject = subject || "这件事";
  return {
    id: `clarify-${simpleTextHash(text)}-1`,
    options: [left, right].map(({ member }) => ({
      label: `提醒${member.displayName}`,
      queryText: `安排${member.displayName}负责处理：${taskSubject}，请创建任务。`,
      value: "create_task" as const
    })),
    originalText: text,
    prompt: "这件事需要确认由谁负责：",
    round: 1
  };
}

function buildFamilyOccasionClarification(
  text: string,
  members: FamilyMember[]
): AssistantClarification | undefined {
  if (
    /[?？]/.test(text) ||
    /(?:提醒|待办|任务|安排|负责|创建|改成|说错|以最后|为准)/.test(text) ||
    !/(今天|今晚|明天|后天|这周|本周|下周|周[一二三四五六日天]|\d{1,2}月\d{1,2}[日号])/.test(text)
  ) {
    return undefined;
  }
  const occasion = text.match(/(生日|纪念日|考试|面试|体检|复查|手术|演出|比赛|出发|旅行)/)?.[1];
  const member = findMemberReference(text, members, {}, "first")?.member;
  if (!occasion || !member) return undefined;

  return {
    id: `clarify-${simpleTextHash(text)}-1`,
    options: [
      {
        label: "提醒我关心一下",
        queryText: `${text}。请创建一个提醒我关心${member.displayName}${occasion}的任务。`,
        value: "create_task"
      },
      {
        label: "记住这件事",
        queryText: `${text}。把这条家庭重要事件作为长期资料保存。`,
        value: "save_knowledge"
      },
      {
        label: "一起想想怎么安排",
        queryText: `想想${member.displayName}${occasion}该怎么安排`,
        value: "continue_chat"
      }
    ],
    originalText: text,
    prompt: `听到了：${text.replace(/[。.!！?？]+$/, "")}。你想让我怎么帮忙？`,
    round: 1
  };
}

function findSegmentSpeaker(text: string, members: FamilyMember[]) {
  return members
    .flatMap((member) => {
      const index = Math.max(text.lastIndexOf(`${member.displayName}：`), text.lastIndexOf(`${member.displayName}:`));
      return index >= 0 ? [{ index, member }] : [];
    })
    .sort((left, right) => right.index - left.index)[0]?.member;
}

function findAlternativeSeparator(text: string) {
  for (const value of ["还是", "或者", "或是", "抑或"]) {
    const index = text.indexOf(value);
    if (index >= 0) return { index, value };
  }
  return null;
}

function findMemberReference(
  text: string,
  members: FamilyMember[],
  context: AssistantRouteContext,
  direction: "first" | "last"
) {
  const references = members.flatMap((member) => {
    const aliases = new Set([member.displayName, ...(memberAliasGroups[member.id] || [])]);
    return [...aliases].flatMap((alias) => {
      const effectiveMember =
        alias === "我" && context.actorMemberId
          ? members.find((candidate) => candidate.id === context.actorMemberId) || member
          : member;
      const indexes: number[] = [];
      let from = 0;
      while (from < text.length) {
        const index = text.indexOf(alias, from);
        if (index < 0) break;
        indexes.push(index);
        from = index + Math.max(1, alias.length);
      }
      return indexes.map((index) => ({ alias, index, member: effectiveMember }));
    });
  });
  return references.sort((left, right) =>
    direction === "first"
      ? left.index - right.index || right.alias.length - left.alias.length
      : right.index - left.index || right.alias.length - left.alias.length
  )[0];
}

function compactAssigneeChoiceSubject(text: string) {
  return text
    .replace(/(?:请|帮我|麻烦)?(?:提醒|安排|交给|派给|让|由|给)/g, " ")
    .replace(/(?:负责|处理|去做|来做|做一下|创建任务|整理成任务)/g, " ")
    .replace(/[，,。.!！?？：:\s]+/g, " ")
    .trim()
    .slice(0, 80);
}

export function resolveAssistantClarification(
  clarification: AssistantClarification,
  selected: AssistantRouteActionButton
): AssistantRoute {
  const sourceText = clarification.originalText;
  const focusText = selected.queryText || selectAssistantRoutingFocus(sourceText);
  const selectedPath = [
    ...(clarification.selectedPath || []),
    { label: selected.label, value: selected.value }
  ];
  if (selected.value === "go_back" && clarification.previous) {
    return { kind: "fallback", clarification: clarification.previous, reason: "assignment_or_search" };
  }
  if (selected.value === "revise_input") {
    return { kind: "fallback", focusText: sourceText, reason: "assignment_or_search" };
  }
  if (selected.value === "continue_chat") {
    return { kind: "action", id: "app.chat", parameters: { text: selected.queryText || sourceText } };
  }
  if (selected.value === "search_web") {
    return { kind: "action", id: "web.search.duckduckgo", parameters: { text: focusText } };
  }
  if (selected.value === "app_help") {
    if (!selected.queryText && clarification.round < 2 && /(?:有哪些|全部|所有|功能|怎么用|帮助)/.test(sourceText)) {
      return {
        kind: "fallback",
        clarification: {
          id: `clarify-${simpleTextHash(sourceText)}-2`,
          options: [
            { label: "任务与提醒", queryText: "任务和提醒怎么用？", value: "app_help" },
            { label: "群聊与投票", queryText: "投票怎么用？", value: "app_help" },
            { label: "AI 与记忆", queryText: "AI 名称、个性和记忆怎么用？", value: "app_help" }
          ],
          originalText: sourceText,
          parentId: clarification.id,
          prompt: "你主要想了解哪一部分？",
          round: 2,
          selectedPath
        },
        reason: "assignment_or_search"
      };
    }
    return {
      kind: "action",
      id: "app.answer",
      parameters: { queryType: "app.capabilities", text: focusText }
    };
  }
  if (selected.value === "create_task") {
    if (
      clarification.round < 2 &&
      !isReminderCreationRequest(focusText) &&
      !/(?:分给|派给|交给|安排|负责|让).{0,24}(?:做|处理|完成|去)/.test(focusText)
    ) {
      return {
        kind: "fallback",
        clarification: {
          id: `clarify-${simpleTextHash(sourceText)}-2`,
          options: [
            {
              label: "提醒我处理",
              queryText: `${focusText}。请整理成提醒我处理的任务。`,
              value: "create_task"
            },
            {
              label: "先补充内容",
              value: "revise_input"
            },
            { label: "返回上一步", value: "go_back" }
          ],
          originalText: sourceText,
          parentId: clarification.id,
          previous: clarification,
          prompt: "可以整理成任务，还需要确认由谁处理：",
          round: 2,
          selectedPath
        },
        reason: "assignment_or_search"
      };
    }
    return {
      kind: "fallback",
      focusText,
      reason: "assignment_or_search",
      suggestedAction: "task.create.input"
    };
  }
  if (
    selected.value === "save_knowledge" &&
    clarification.round < 2 &&
    !isKnowledgeSaveCandidate(focusText, [])
  ) {
    return {
      kind: "fallback",
      clarification: {
        id: `clarify-${simpleTextHash(sourceText)}-2`,
        options: [
          {
            label: "存为长期资料",
            queryText: `${focusText}。把前面的信息作为长期资料保存。`,
            value: "save_knowledge"
          },
          {
            label: "只在这次聊",
            value: "continue_chat"
          },
          { label: "重新描述", value: "revise_input" },
          { label: "返回上一步", value: "go_back" }
        ],
        originalText: sourceText,
        parentId: clarification.id,
        previous: clarification,
        prompt: "这条信息准备怎么使用？",
        round: 2,
        selectedPath
      },
      reason: "assignment_or_search"
    };
  }
  return {
    kind: "fallback",
    focusText,
    reason: "assignment_or_search",
    suggestedAction: "memory.save"
  };
}

function simpleTextHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function describeAssistantRouteContract(text: string, members: FamilyMember[], context: AssistantRouteContext = {}): AssistantRouteContract {
  const normalized = selectAssistantRoutingFocus(normalizeInput(text));
  if (!normalized) {
    return clarificationRoute("输入为空。");
  }

  const dangerousOperation = detectDangerousOperation(normalized);
  if (dangerousOperation) {
    return makeRouteContract({
      candidateActions: ["safety.dangerous_operation"],
      confidence: 1,
      displayTarget: "inline_assistant",
      displayType: "error_card",
      intent: ["dangerous"],
      reason: dangerousOperation.reason,
      summary: "危险操作已隔离。"
    });
  }

  const contextualGroupPlan = resolveContextualGroupPlan(normalized, members, context);
  if (contextualGroupPlan) {
    return makeRouteContract({
      candidateActions: ["group.organize.contextual"],
      confidence: 1,
      displayTarget: "group_chat",
      displayType: "chat_reply",
      entities: contextualGroupPlan,
      intent: ["group_chat"],
      reason: "用户已在连续对话中确认家庭活动，并明确要求家庭助手代为组群沟通。",
      requiresConfirmation: false,
      summary: `创建「${contextualGroupPlan.title}」并发布活动详情`
    });
  }
  if (buildContextualGroupDateClarification(normalized, context)) {
    return makeRouteContract({
      candidateActions: ["app.chat"],
      confidence: 1,
      displayTarget: "inline_assistant",
      displayType: "confirmation_card",
      entities: { missingFields: ["date"] },
      intent: ["ambiguous"],
      reason: "活动和建群授权已经明确，但缺少可执行的日期锚点。",
      requiresConfirmation: false,
      summary: "这场 Party 准备哪一天举行？告诉我日期后，我就可以组群问大家。"
    });
  }

  const memberKnowledgePlan = resolveMemberKnowledgeQueryPlan(normalized, members, context);
  if (memberKnowledgePlan) {
    return makeRouteContract({
      candidateActions: ["member.knowledge.resolve"],
      confidence: 0.98,
      displayTarget: "group_chat",
      displayType: "chat_reply",
      entities: memberKnowledgePlan,
      intent: ["app_answer", "group_chat"],
      reason: "先检索家庭记录和确认记忆；若没有可靠依据，只向目标家人发起定向询问，不猜测答案。",
      requiresConfirmation: false,
      summary: `核实${memberKnowledgePlan.memberName}的信息`
    });
  }

  const familyQuestionPlan = resolveFamilyQuestionPlan(normalized, members, context);
  if (familyQuestionPlan) {
    return makeRouteContract({
      candidateActions: ["group.ask.family"],
      confidence: 1,
      displayTarget: "group_chat",
      displayType: "chat_reply",
      entities: { familyQuestionPlan },
      intent: ["group_chat"],
      reason: "用户明确要求家庭助手向家人收集回答，应进入家庭群聊协作而不是创建个人任务。",
      requiresConfirmation: false,
      summary: `创建「${familyQuestionPlan.title}」并询问家人`
    });
  }

  if (isExplicitlyUncertainRequest(normalized)) {
    return makeRouteContract({
      candidateActions: ["app.chat"],
      confidence: 0.55,
      displayTarget: "inline_assistant",
      displayType: "confirmation_card",
      intent: ["ambiguous"],
      reason: "用户明确表示意图或处理方式尚未确定。",
      summary: "我先确认你希望怎么处理。",
      actionButtons: buildAssistantClarification(normalized)?.options || clarificationButtons()
    });
  }

  if (isExplicitNoActionRequest(normalized)) {
    return makeRouteContract({
      candidateActions: ["app.chat"],
      confidence: 0.95,
      displayTarget: "inline_assistant",
      displayType: "chat_reply",
      intent: ["app_chat"],
      reason: "用户明确表示不执行写入动作。",
      summary: normalized
    });
  }

  if (isPollCreationRequest(normalized)) {
    return makeRouteContract({
      candidateActions: ["decision.create.quick"],
      confidence: 0.98,
      displayTarget: "modal",
      displayType: "confirmation_card",
      intent: ["app_answer"],
      reason: "用户明确要求发起家庭投票，创建前需要确认题目、选项和参与人。",
      requiresConfirmation: true,
      summary: normalized
    });
  }

  if (isJudgementCreationRequest(normalized)) {
    return makeRouteContract({
      candidateActions: ["judgement.create"],
      confidence: 0.98,
      displayTarget: "modal",
      displayType: "confirmation_card",
      intent: ["app_answer"],
      reason: "用户明确要求发起评评理，AI 只整理双方观点，正式发起前需要确认。",
      requiresConfirmation: true,
      summary: normalized
    });
  }

  const ragActionId = classifyRagQueryAction(normalized);
  if (ragActionId) {
    return makeRouteContract({
      candidateActions: [ragActionId],
      confidence: 0.96,
      displayTarget: "inline_assistant",
      displayType: "chat_reply",
      intent: ["app_answer"],
      reason: "这是只读依据查询；事实回复必须引用检索到的 evidenceIds，未命中时明确说明未查到。",
      requiresConfirmation: false,
      summary: normalized
    });
  }

  const organizeActionId = classifyOrganizeAction(normalized);
  if (organizeActionId) {
    return makeRouteContract({
      candidateActions: [organizeActionId],
      confidence: 0.96,
      displayTarget: organizeActionId === "resource.organize" ? "resource_list" : "modal",
      displayType: "confirmation_card",
      intent: ["app_answer"],
      reason: "整理会改变记录或资料的呈现结构，先展示范围和变更内容再执行。",
      requiresConfirmation: true,
      summary: normalized
    });
  }

  if (isAiSuggestionRequest(normalized)) {
    return makeRouteContract({
      candidateActions: ["assistant.suggest.next"],
      confidence: 0.94,
      displayTarget: "inline_assistant",
      displayType: "chat_reply",
      intent: ["app_chat"],
      reason: "AI 建议是只读 action；涉及家庭事实时必须引用依据，不能伪装成已执行动作。",
      requiresConfirmation: false,
      summary: normalized
    });
  }

  const inviteMember = extractInviteMemberQuery(normalized, members);
  if (inviteMember) {
    return makeRouteContract({
      candidateActions: ["invite.create"],
      confidence: 0.95,
      displayTarget: "modal",
      displayType: "confirmation_card",
      entities: { member: inviteMember },
      intent: ["invite"],
      reason: "本地规则识别邀请成员。",
      requiresConfirmation: true,
      summary: `邀请 ${inviteMember}`
    });
  }

  if (isWebSearchRequest(normalized)) {
    return makeRouteContract({
      candidateActions: ["web.search.duckduckgo"],
      confidence: 0.9,
      displayTarget: "inline_assistant",
      displayType: "web_search_result",
      intent: ["web_search"],
      reason: "本地规则识别联网搜索。",
      summary: normalized
    });
  }

  const summaryActionId = extractDeepSummaryActionId(normalized);
  if (summaryActionId) {
    return makeRouteContract({
      candidateActions: [summaryActionId],
      confidence: 0.9,
      displayTarget: "inline_assistant",
      displayType: "chat_reply",
      intent: ["summary_request"],
      reason: "本地规则识别总结请求。",
      summary: normalized
    });
  }

  const memberRename = extractMemberRenameIntent(normalized, members);
  if (memberRename) {
    return makeRouteContract({
      candidateActions: ["member.rename"],
      confidence: 0.98,
      displayTarget: "modal",
      displayType: "confirmation_card",
      entities: { member: memberRename.memberName, newName: memberRename.newName },
      intent: ["app_answer"],
      reason: "本地规则识别成员改名请求，写入前必须确认。",
      requiresConfirmation: true,
      summary: `把 ${memberRename.memberName} 改名为 ${memberRename.newName}`
    });
  }

  if (isKnowledgeSaveCandidate(normalized, members)) {
    return makeRouteContract({
      candidateActions: ["memory.save"],
      confidence: 0.88,
      displayTarget: "resource_list",
      displayType: "resource_item",
      intent: ["knowledge"],
      reason: "本地规则识别长期资料候选。",
      requiresConfirmation: true,
      summary: normalized
    });
  }

  if (isReminderCreationRequest(normalized)) {
    return makeRouteContract({
      candidateActions: ["task.create.input"],
      confidence: 0.9,
      displayTarget: "task_list",
      displayType: "task_candidate",
      intent: ["reminder", "task"],
      reason: "本地规则识别提醒/待办候选。",
      requiresConfirmation: true,
      summary: normalized
    });
  }

  if (isAssignmentTaskRequest(normalized, members)) {
    return makeRouteContract({
      candidateActions: ["task.create.input"],
      confidence: 0.9,
      displayTarget: "task_list",
      displayType: "task_candidate",
      intent: ["task"],
      reason: "本地规则识别指派任务候选。",
      requiresConfirmation: true,
      summary: normalized
    });
  }

  if (isWeatherQuestionRequest(normalized)) {
    return makeRouteContract({
      candidateActions: ["app.chat"],
      confidence: 0.92,
      displayTarget: "inline_assistant",
      displayType: "chat_reply",
      intent: ["app_chat"],
      reason: "天气能力已下线，改为普通说明。",
      summary: normalized
    });
  }

  const appAnswerQueryType = classifyAppAnswerQuery(normalized);
  if (appAnswerQueryType !== "unknown") {
    const recordDate = appAnswerQueryType === "records.recent" ? readRecordDate(normalized) : undefined;
    return makeRouteContract({
      candidateActions: ["app.answer"],
      confidence: 0.92,
      displayTarget: "inline_assistant",
      displayType: "chat_reply",
      entities: { queryType: appAnswerQueryType, ...(recordDate ? { recordDate } : {}) },
      intent: ["app_answer"],
      reason: "本地规则识别 App 内部问答。",
      summary: normalized
    });
  }

  const profileMemberQuery = extractProfileMemberQuery(normalized, members);
  if (profileMemberQuery) {
    return makeRouteContract({
      candidateActions: ["profile.describe"],
      confidence: 0.95,
      displayTarget: "inline_assistant",
      displayType: "profile_card",
      entities: { member: profileMemberQuery },
      intent: ["profile_describe"],
      reason: "本地规则识别人物画像查询。",
      summary: normalized
    });
  }

  if (isDailyLifeLogRequest(normalized)) {
    return makeRouteContract({
      candidateActions: ["app.chat"],
      confidence: 0.78,
      displayTarget: "inline_assistant",
      displayType: "chat_reply",
      intent: ["daily_log"],
      reason: "本地规则识别生活记录。",
      summary: normalized
    });
  }

  if (isUnconfirmedPersonalFactStatement(normalized) || isShortContextContinuation(normalized, context)) {
    return makeRouteContract({
      candidateActions: ["app.chat"],
      confidence: 0.9,
      displayTarget: "inline_assistant",
      displayType: "chat_reply",
      intent: ["app_chat"],
      reason: "这是未授权保存的个人陈述或连续对话补充，只在本轮聊天中使用。",
      summary: normalized
    });
  }

  if (isCasualConversationRequest(normalized)) {
    return makeRouteContract({
      candidateActions: ["app.chat"],
      confidence: 0.75,
      displayTarget: "inline_assistant",
      displayType: "chat_reply",
      intent: ["app_chat"],
      reason: "本地规则识别普通对话。",
      summary: normalized
    });
  }

  return makeRouteContract({
    candidateActions: ["app.chat"],
    confidence: 0.55,
    displayTarget: "inline_assistant",
    displayType: "confirmation_card",
    intent: ["ambiguous"],
    reason: "本地规则无法稳定判断。",
    summary: "我不太确定你想怎么处理。",
    actionButtons: clarificationButtons()
  });
}

export function selectAssistantRoutingFocus(text: string) {
  const normalized = normalizeInput(text);
  const segments = normalized
    .split(/(?<=[。！？!?；;\n])|\n+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length < 6 && normalized.length <= 240) {
    return normalized;
  }
  const ranked = segments
    .map((segment, index) => ({ index, score: scoreRoutingSegment(segment), segment }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.index - left.index);
  const anchor = ranked[0];
  if (!anchor) return normalizeInput(segments.at(-1) || normalized);
  if (anchor.score >= 14) {
    return normalizeInput(anchor.segment);
  }
  const includeNext =
    anchor.index === 0 &&
    /(?:建立|创建|弄个|加个).{0,4}(?:提醒|任务)|(?:保存|记住|记下)(?:它|这个|这件事)?[。.!！?？]*$/.test(anchor.segment);
  return normalizeInput(
    segments
      .slice(Math.max(0, anchor.index - 2), Math.min(segments.length, anchor.index + (includeNext ? 2 : 1)))
      .join("")
  );
}

function scoreRoutingSegment(segment: string) {
  const content = segment.replace(/^(?:小明|老婆|老妈|妈妈|爸爸|姐姐|闺女|女儿|儿子|家人|成员[^：:\s]{0,8})[：:]\s*/, "");
  let score = 0;
  if (isExplicitNoActionRequest(content)) score += 22;
  if (classifyAppAnswerQuery(content) !== "unknown") score += 30;
  if (isTaskStateStatement(content)) score += 25;
  if (isWebSearchRequest(content)) score += 30;
  if (
    isTimedTaskStatement(content) &&
    /(?:提醒|需要|准备|计划|打算|要|去|买|拿|取|送|接|复查|复测|预约|缴费|交费|提交)/.test(content)
  ) {
    score += 14;
  }
  if (isKnowledgeSaveCandidate(content, [])) score += 13;
  if (/(?:长期资料|长期记忆).{0,10}(?:保存|记下|记住)|(?:保存|记下|记住).{0,10}(?:长期资料|长期记忆)/.test(content)) {
    score += 13;
  }
  if (/(?:说错了|不对|改成|换成|作废|以最后|重新安排)/.test(content)) score += 16;
  if (findAlternativeSeparator(content) && /(?:提醒|安排|负责|处理|去做|来做)/.test(content)) score += 20;
  if (
    /^(?:请|麻烦|帮我|给我|替我)?(?:提醒|记住|记下|保存|存一下|联网搜索|网络搜索|上网查|搜索|搜一下|查一下|总结|回顾|创建|新建|建群|修改|删除)/.test(content) ||
    /^(?:把|将).{1,36}(?:记住|记下|保存|存入|加入资料)/.test(content)
  ) {
    score += 12;
  }
  if (/(?:让|叫|安排).{1,28}(?:明天|后天|今天|周|星期|\d{1,2}\s*(?:点|时|:))/.test(content)) {
    score += 12;
  }
  if (/[?？]$/.test(content)) score += 7;
  if (/(?:什么|啥|怎么|咋|谁|哪|多少|几点|为什么|为啥|能否|可以吗|行吗|吗|呢)/.test(content)) score += 5;
  if (/(?:人物画像|画像|任务|待办|资料库|投票|语音|网络|公网|局域网|通知|功能)/.test(content)) score += 3;
  if (/(?:AI|助手).{0,12}(?:名称|名字|个性|性格|记忆|设置|配置)/i.test(content)) score += 5;
  if (!isExplicitNoActionRequest(content) && /(?:不要|不用|别|取消|不是|不对|先别|无需)/.test(content)) score -= 2;
  return score;
}

function isExplicitNoActionRequest(text: string) {
  return (
    /^(?:我)?(?:只是|就|继续).{0,6}(?:聊天|聊聊|说说)/.test(text) ||
    /(?:不要|不用|别|无需).{0,8}(?:(?:创建|生成|整理成|安排).{0,4})?(?:任务|待办|提醒)/.test(text) ||
    /(?:不要|不用|别|无需).{0,8}(?:保存|记住|记下|写入).{0,6}(?:资料|记忆|画像)?/.test(text) ||
    /(?:不要|不用|别|无需).{0,4}(?:再)?(?:创建|生成|安排|保存)/.test(text) ||
    /(?:这|这些)(?:只是|属于)(?:一段|一次)?普通(?:家庭)?日常/.test(text) ||
    /(?:先)?(?:不要|不用|别|无需|先别).{0,10}(?:建群|组群|群聊|发投票|投票|评评理|整理|改名|改.{0,6}名字|执行.{0,4}动作)/.test(text)
  );
}

function isPollCreationRequest(text: string) {
  return /(?:发起|创建|建个|做个|开个|发个|让大家|请大家|大家).{0,12}(?:投票|表决)|(?:投票|表决).{0,20}(?:决定|选|是否|还是)|二选一投票/.test(text);
}

function isJudgementCreationRequest(text: string) {
  return /(?:评评理|发起评理|建一个评理)/.test(text);
}

function classifyRagQueryAction(text: string): "rag.query.family" | "rag.query.resources" | "rag.query.memory" | null {
  if (/(?:确认过的记忆|从记忆|你记得|回忆一下).*(?:吗|找|偏好|习惯|不吃|喜欢)|(?:记忆里).*(?:找|查|回忆)/.test(text)) {
    return "rag.query.memory";
  }
  if (/(?:资料|资料库|附件|文件|文档|报告|保险单).*(?:找|查|检索|有没有)|(?:从|在).{0,6}(?:资料|资料库|附件).*(?:找|查|检索)/.test(text)) {
    return "rag.query.resources";
  }
  if (/(?:家庭记录|家庭历史|家里以前|家庭时间线).*(?:找|查|谁|时间|结果)|(?:根据|从).{0,6}(?:家庭记录|家庭历史).*(?:找|查|检索)/.test(text)) {
    return "rag.query.family";
  }
  return null;
}

function classifyOrganizeAction(text: string): "record.organize" | "resource.organize" | null {
  if (isSummaryRequestText(text)) return null;
  if (!/(?:整理|归类)/.test(text)) return null;
  if (/(?:创建|新建|安排|给|让).{0,28}(?:任务|待办)/.test(text)) return null;
  if (/(?:资料|资料库|附件|照片|文档|文件)/.test(text)) return "resource.organize";
  if (/(?:家庭记录|记录|任务|家庭事件|过去|最近|本周|今天)/.test(text)) return "record.organize";
  return null;
}

function isAiSuggestionRequest(text: string) {
  return /(?:AI|助手|你).{0,8}(?:建议|给个建议|下一步)|(?:给我|帮我).{0,6}(?:建议|想个下一步)/i.test(text);
}

function isExplicitlyUncertainRequest(text: string) {
  const normalized = normalizeInput(text);
  return (
    /(?:拿不准|不确定|没想好|没有想好|还没决定|没有决定).{0,18}(?:怎么处理|怎么办|如何处理|是否|该不该|要不要)/.test(normalized) ||
    /(?:分不清|不知道|不清楚).{0,18}(?:入口|选哪个|哪一部分|怎么处理)/.test(normalized) ||
    /(?:该先|应该先).{0,12}(?:了解|处理|选择)(?:哪|什么)/.test(normalized)
  );
}

function applyLongInputFocus(route: AssistantRoute, fullText: string, focusText: string): AssistantRoute {
  if (route.kind === "action") {
    return {
      ...route,
      parameters: {
        ...route.parameters,
        text: route.id === "app.chat" ? fullText : focusText
      }
    };
  }
  if (route.kind === "pipeline" || route.kind === "automation") {
    return {
      ...route,
      parameters: {
        ...route.parameters,
        text: focusText
      }
    };
  }
  return {
    ...route,
    clarification: route.clarification
      ? {
          ...route.clarification,
          originalText: fullText
        }
      : undefined,
    focusText
  };
}

export function buildRouteIntentPrompt(input: RouteIntentPromptInput) {
  const candidateActions = input.candidateActions.map((action) => ({
    id: action.id,
    label: action.label,
    requiresConfirmation: action.requiresConfirmation,
    sideEffectLevel: action.sideEffectLevel
  }));
  return `route-intent-v1

你是家庭生活 App 的意图路由器。
你的任务是把用户输入分类成结构化 JSON。
你不能执行动作。
你不能调用工具。
你不能修改数据。
你不能创建任务。
你不能创建提醒。
你不能保存资料。
你不能邀请成员。
你只能从给定候选 intent、displayTarget、displayType、candidateActions 中选择。
如果不确定，intent 使用 ambiguous。

当前日期：
${input.currentDate}

当前用户：
${input.actorName}

家庭成员：
${input.familyMembers.map((member) => `${member.displayName}(${member.id})`).join("、")}

最近上下文：
${input.recentContext}

用户输入：
${input.userInput}

候选 intent：
- daily_log
- task
- reminder
- knowledge
- app_answer
- app_chat
- web_search
- profile_describe
- invite
- summary_request
- dangerous
- ambiguous

候选 displayTarget：
- inline_assistant
- task_list
- resource_list
- group_chat
- modal
- toast
- none

候选 displayType：
- chat_reply
- task_candidate
- task_item
- resource_item
- profile_card
- web_search_result
- confirmation_card
- error_card

候选 actions：
${JSON.stringify(candidateActions, null, 2)}

app.answer 的 entities.queryType 只允许：
api.usage、app.capabilities、system.time、system.date、members.count、members.list、members.online、profiles.available、
tasks.outgoing、tasks.incoming、tasks.pending、tasks.help、resources.list、records.recent、unknown。

输出要求：
只输出合法 JSON，不要输出 markdown，不要解释。

输出格式：
{
  "intent": [],
  "confidence": 0.0,
  "candidateActions": [],
  "entities": {}
}

只返回这四个必要字段。displayTarget、displayType、requiresConfirmation、summary、reason、actionButtons 由 App 根据 action 合同补齐，不要输出。

规则：
1. 创建任务、创建提醒、保存长期资料、邀请成员、修改成员、删除/归档，都必须 requiresConfirmation=true。
2. 普通问答、搜索、画像查询结果必须 displayTarget=inline_assistant。
3. 任务候选必须 displayTarget=task_list，displayType=task_candidate。
4. 资料保存候选必须 displayTarget=resource_list，displayType=resource_item。
5. 邀请成员必须 displayTarget=modal，displayType=confirmation_card。
6. 危险操作必须 intent 包含 dangerous，并使用 safety.dangerous_operation。
7. 如果用户只是问问题，不要强行创建任务。
8. 不要编造用户没有说过的人、时间、地点、任务。
9. confidence 低于 0.65 时，intent 使用 ambiguous 或返回澄清建议。
10. 把当前输入和最近上下文合起来理解：处理“他/她/这个/那个/呢”等指代、省略主语的短句、口语、错别字和中英文混输；不要靠当前一句的字面关键词孤立分类。
11. entities 必须写出解析后的实体。画像查询使用 {"member":"成员显示名"}；App 问答使用 {"queryType":"白名单值"}；家庭记录回顾若有明确日期，另带 {"recordDate":"YYYY-MM-DD"}。
12. 上下文无法唯一确定指代时使用 ambiguous，不要猜成员。
13. 模型只能提出候选。任何有副作用的 action 即使识别出来，也不能表示已经执行。`;
}

export function validateAssistantRouteCandidate(
  value: unknown,
  fallback: {
    fallbackDisplayTarget: AutomationDisplayTarget;
    fallbackDisplayType: AutomationDisplayType;
  }
): ValidateAssistantRouteCandidateResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      reason: "invalid_json",
      route: clarificationRoute("模型输出不是合法 JSON。")
    };
  }

  const candidate = value as Record<string, unknown>;
  const intent = readRouteIntentArray(candidate.intent);
  if (!intent.length) {
    return {
      ok: false,
      reason: "invalid_intent",
      route: clarificationRoute("模型输出的 intent 不在白名单。")
    };
  }

  const candidateActions = readCandidateActions(candidate.candidateActions);
  if (candidateActions.length === 0) {
    const inferredAction = defaultActionForIntent(intent);
    if (inferredAction) candidateActions.push(inferredAction);
  }
  if (!intent.includes("ambiguous") && candidateActions.length === 0) {
    return {
      ok: false,
      reason: "invalid_schema",
      route: clarificationRoute("模型没有返回白名单 action。")
    };
  }
  const displayTarget = readDisplayTarget(candidate.displayTarget) || fallback.fallbackDisplayTarget;
  const displayType = readDisplayType(candidate.displayType) || fallback.fallbackDisplayType;
  const confidence = readConfidence(candidate.confidence);
  const route = makeRouteContract({
    actionButtons: readActionButtons(candidate.actionButtons),
    candidateActions,
    confidence,
    displayTarget,
    displayType,
    entities: readRecord(candidate.entities),
    intent,
    reason: readOptionalString(candidate.reason),
    requiresConfirmation: readOptionalBoolean(candidate.requiresConfirmation) ?? inferRequiresConfirmation(candidateActions),
    summary: readOptionalString(candidate.summary)
  });

  if (confidence < 0.65) {
    return {
      ok: false,
      reason: "low_confidence",
      route: clarificationRoute("我不太确定你想怎么处理。")
    };
  }

  return {
    ok: true,
    route
  };
}

export function extractMemberRenameIntent(text: string, members: FamilyMember[]) {
  const normalized = normalizeInput(text);
  const match =
    normalized.match(/^(?:请|请帮我|帮我)?(?:把|将)\s*(.{1,16}?)(?:的)?(?:显示名称|显示名|名字|名称)?\s*(?:改名为|改名成|改成|改为|换成)\s*([^，,。.!！?？\s]{1,16})(?:吧)?[。.!！?？]?$/) ||
    normalized.match(/^(.{1,16}?)(?:\s|，|,)*(?:你)?以后(?:就)?(?:叫做|叫|改叫|名字叫|名称叫)\s*([^，,。.!！?？\s]{1,16})(?:吧)?[。.!！?？]?$/);
  if (!match) {
    return null;
  }

  const memberQuery = match[1].trim();
  const newName = match[2].replace(/吧$/, "").trim();
  const matchedMember = members.find((member) => member.displayName === memberQuery || memberQuery.includes(member.displayName));
  const aliasMember = matchedMember || resolveMemberAlias(memberQuery, members);

  if (!aliasMember || !newName) {
    return null;
  }

  return {
    memberId: aliasMember.id,
    memberName: aliasMember.displayName,
    newName
  };
}

export function extractProfileMemberQuery(text: string, members: FamilyMember[]) {
  const normalized = normalizeInput(text);
  if (/(你有谁|都有谁|有谁|哪些人|谁的).*(人物画像|画像)|(人物画像|画像).*(你有谁|都有谁|有谁|哪些人|最全)/.test(normalized)) {
    return "";
  }
  const asksProfile =
    /人物画像|画像|什么样的人|什么人|是什么人|什么样|啥样|怎么样|咋样|了解一下|介绍一下|身体怎么样|身体咋样|健康情况|基础病/.test(
      normalized
    );
  if (!asksProfile) {
    return "";
  }
  if (isCollectiveProfileRequest(normalized)) {
    return "";
  }

  const matchedMember = members.find((member) => normalized.includes(member.displayName));
  if (matchedMember) {
    return matchedMember.displayName;
  }

  const aliasMember = resolveMemberAlias(normalized, members);
  if (aliasMember) {
    return aliasMember.displayName;
  }

  return "";
}

export function isProfileLearningRequest(text: string) {
  const normalized = normalizeInput(text);
  if (/^(修改资料|更新资料|整理资料|补充资料|维护资料)(?:\s|，|,|。|$)/.test(normalized)) {
    return true;
  }

  return isCollectiveProfileRequest(normalized) && /(整理|更新|学习|生成|刷新|提取|归纳|汇总|重新|重建)/.test(normalized);
}

function extractDeepSummaryActionId(text: string): AutomationActionId | null {
  const normalized = normalizeInput(text);
  if (/^深度总结(?:\s|，|,|。|$)/.test(normalized)) {
    if (/家庭|全家/.test(normalized) && /月|本月/.test(normalized)) {
      return "summary.family.monthly";
    }
    if (/家庭|全家/.test(normalized) && /周|本周/.test(normalized)) {
      return "summary.family.weekly";
    }
    if (/家庭|全家/.test(normalized)) {
      return "summary.family.daily";
    }
    if (/月|本月/.test(normalized)) {
      return "summary.family.monthly";
    }
    if (/周|本周/.test(normalized)) {
      return "summary.personal.weekly";
    }
    return "summary.personal.daily";
  }
  if (/家庭|全家/.test(normalized) && /月总结|本月总结|总结本月/.test(normalized)) {
    return "summary.family.monthly";
  }
  if (/家庭|全家/.test(normalized) && /周总结|本周总结|总结本周/.test(normalized)) {
    return "summary.family.weekly";
  }
  if (/家庭|全家/.test(normalized) && /日总结|今日总结|今天总结|总结今天/.test(normalized)) {
    return "summary.family.daily";
  }
  if (/总结本周|本周总结|周总结/.test(normalized)) {
    return "summary.personal.weekly";
  }
  if (/总结今天|今天总结|今日总结|日总结/.test(normalized)) {
    return "summary.personal.daily";
  }
  if (isSummaryRequestText(normalized)) {
    return "summary.personal.daily";
  }
  return null;
}

export function isAppQuestionRequest(text: string) {
  return classifyAppAnswerQuery(text) !== "unknown";
}

export function classifyAppAnswerQuery(text: string): AppAnswerQueryType {
  const normalized = normalizeInput(text);
  if (/^(记录一下|记一下|记下来)/.test(normalized)) {
    return "unknown";
  }
  const asksForDirectedTasks =
    /(我派出|我发起|派出去|派给我|派给我的|给我的|我需要处理).*(任务|待办)|谁.*(?:给我|向我|帮我|派|指派|安排|发起).*(任务|待办)/.test(normalized);
  if (
    !asksForDirectedTasks &&
    /(?:任务|待办).*(?:记录|有啥|有什么|有哪些|哪些|列表|情况)|(?:有啥|有什么|有哪些|哪些).*(?:任务|待办)/.test(normalized)
  ) {
    return "tasks.pending";
  }
  const asksForFamilyHistory =
    hasAnyTerm(normalized, ["发生", "记录", "总结", "回顾", "动态", "忙了", "忙什么"]) &&
    (hasAnyTerm(normalized, ["什么", "啥", "哪些", "都", "最近", "今天", "昨天", "前天"]) || /[?？](?:[^?？]*)?$/.test(normalized));
  if (asksForFamilyHistory) {
    return "records.recent";
  }
  if (
    /(?:这个|这款|本|家庭)?\s*(?:app|软件|应用).*(?:功能|怎么用|怎么使用|咋用|能做|会做|介绍|帮助)|你(?:能|会)(?:做|干)(?:什么|啥)|你有啥功能|投票怎么用|投票怎么使用|语音怎么用|网络怎么设置|通知怎么开|(?:AI|助手).{0,12}(?:名称|名字|个性|性格|记忆).{0,10}(?:怎么|如何|设置|配置)|任务完成情况.{0,8}(?:进入|用于).{0,6}总结|意图不清楚.{0,8}(?:怎么|如何)|选择.{0,6}按钮.{0,8}(?:继续|回答)/i.test(normalized)
  ) {
    return "app.capabilities";
  }
  if (/(你有谁|都有谁|有谁|哪些人|谁的).*(人物画像|画像)|(人物画像|画像).*(你有谁|都有谁|有谁|哪些人|最全)/.test(normalized)) {
    return "profiles.available";
  }
  if (/任务在哪|待办在哪|怎么找任务|怎么看任务|任务怎么用|任务(?:和|与)?提醒怎么用/.test(normalized)) {
    return "tasks.help";
  }
  if (/人物画像|画像|创建|新建|建群|群聊|同步|保存|上传/.test(normalized)) {
    return "unknown";
  }
  if (/(?:现在|当前)?(?:是)?几点(?:了|钟)?|现在时间|当前时间|报时/.test(normalized)) {
    return "system.time";
  }

  if (/今天(?:是)?(?:几号|几月几号|星期几|周几|日期)|当前日期|现在(?:是)?几月几号/.test(normalized)) {
    return "system.date";
  }

  if (/(?:家里|家庭).*(?:几个|多少)(?:位)?(?:成员|人)|(?:家庭成员|家里人)(?:数量|有几个|有多少)|家里几口人/.test(normalized)) {
    return "members.count";
  }

  if (
    /(家里|家庭|成员|大家|所有人).*(哪些人|都有谁|有谁|多少人|名单)/.test(normalized) ||
    /(?:哪些人|都有谁|有谁).*(家里|家庭|成员)/.test(normalized)
  ) {
    return "members.list";
  }

  if (/(查询消费|api使用量|api 使用量|模型花费|模型消费|token|tokens|调用费用|调用花费|接口费用|接口消费)/i.test(normalized)) {
    return "api.usage";
  }

  if (/谁在线|谁在/.test(normalized)) {
    return "members.online";
  }
  if (/^(?:妈|妈妈|老妈|爸|爸爸|老爸|老婆|姐姐|儿子|闺女|女儿)呢[。.!！?？]*$/.test(normalized)) {
    return "members.online";
  }

  if (/(我派出|我发起|派出去).*(任务|待办)/.test(normalized)) {
    return "tasks.outgoing";
  }

  if (/(还有|当前|现在)/.test(normalized) && /(任务|待办)/.test(normalized) && /(没处理|待处理|未完成|多少)/.test(normalized)) {
    return "tasks.pending";
  }

  if (
    /(派给我|派给我的|给我的|我需要处理).*(任务|待办)/.test(normalized) ||
    /谁.*(给我|向我|帮我).*(派|指派|安排|发起).*(任务|待办)/.test(normalized) ||
    /谁.*(派|指派|安排|发起).*(我).*(任务|待办)/.test(normalized) ||
    /(任务|待办).*(谁|哪位|谁给|谁派|谁安排|谁指派)/.test(normalized)
  ) {
    return "tasks.incoming";
  }

  if (/(资料库|资料|文件|照片).*(有什么|有哪些|多少|谁给|来源)/.test(normalized)) {
    return "resources.list";
  }

  return "unknown";
}

function isWebSearchRequest(text: string) {
  const normalized = normalizeInput(text);
  if (!normalized) {
    return false;
  }

  if (/^(联网搜索|网络搜索|搜索一下|搜一下|查一下|查下|帮我搜|帮我查|上网查|网上查)/.test(normalized)) {
    return true;
  }

  if (/(联网|上网|网上|网页|浏览器|搜索|搜一下|查一下|查下|新闻|热搜|官网|外部资料|公开资料)/.test(normalized)) {
    return true;
  }
  return /(?:最新|价格|行情|版本|发布).{0,12}(?:是什么|多少|查询|查找|官网|新闻)|(?:查询|查找).{0,12}(?:最新|价格|行情|版本|发布)/.test(
    normalized
  );
}

export function isConversationContextQuestion(text: string) {
  const normalized = normalizeInput(text);
  return (
    /(?:最后|当前|现在).{0,12}(?:承诺|安排|版本|由谁|谁做|位置)/.test(normalized) ||
    /(?:理解|复述|概括|总结).{0,12}(?:这轮|刚才|前面|版本|承诺|改口)/.test(normalized) ||
    /(?:旧版本|前面的说法).{0,16}(?:否定|不算|作废|改了)/.test(normalized) ||
    /按(?:最后|最新|刚才).{0,8}(?:改口|说法|版本)/.test(normalized) ||
    /(?:事实|已知).{0,12}(?:确认|推断|猜测)|(?:确认|推断|猜测).{0,12}(?:事实|已知)/.test(normalized)
  );
}

export function isFamilyKnowledgeRecallQuestion(text: string) {
  const normalized = normalizeInput(text);
  return (
    /(?:医保卡|社保卡|钥匙|证件|药盒|药|文件|资料).{0,12}(?:在哪|哪里|放哪|位置)|(?:在哪|哪里|放哪|位置).{0,12}(?:医保卡|社保卡|钥匙|证件|药盒|药|文件|资料)/.test(
      normalized
    ) ||
    /(?:生日|纪念日).{0,12}(?:哪天|哪一天|几号|什么时候)|(?:哪天|哪一天|几号|什么时候).{0,12}(?:生日|纪念日)/.test(
      normalized
    )
  );
}

function isTaskStateStatement(text: string) {
  const normalized = normalizeInput(text);
  if (/[?？]/.test(normalized)) return false;
  return (
    /(?:任务|待办|安排).{0,18}(?:已完成|完成了|还没完成|没有完成|未完成|进行中|已取消|取消了)/.test(normalized) ||
    /(?:已完成|完成了|还没完成|没有完成|未完成|进行中|已取消|取消了).{0,18}(?:任务|待办|安排)/.test(normalized)
  );
}

export function isWeatherQuestionRequest(text: string) {
  const normalized = normalizeInput(text);
  if (!normalized || isReminderCreationRequest(normalized) || /(吃饭|吃啥|吃什么|早餐|早饭|午餐|午饭|晚餐|晚饭|夜宵|点外卖|做饭|菜单|饭店|餐厅)/.test(normalized)) {
    return false;
  }
  return /(天气|气温|温度|降雨|下雨|下雪|预报|湿度|风速|空气质量|最近\s*7\s*天|最近\s*七\s*天|一\s*周天气)/.test(normalized);
}

export function isReminderCreationRequest(text: string) {
  const normalized = normalizeInput(text);
  if (/(?:挺|很|真|特别).{0,4}(?:好喝|好吃|香|不错|放松)/.test(normalized)) {
    return false;
  }
  if (/(别|不要|不用|取消|撤销|不必).{0,6}(提醒|记得)|(?:提醒|记得).{0,6}(取消|不用|不要)/.test(normalized)) {
    return false;
  }
  return isTimedTaskStatement(normalized) || /^(提醒我|记得|帮我提醒|帮我记得|待办|安排我)/.test(normalized) || /(提醒我|记得我|加入待办|设个提醒|设提醒)/.test(normalized);
}

export function isDailyLifeLogRequest(text: string) {
  const normalized = normalizeInput(text);
  if (
    !normalized ||
    /[?？]$|(?:吗|么|呢)[。.!！]*$|(?:什么|啥|哪些|怎么|如何|为何|为什么)/.test(normalized)
  ) {
    return false;
  }

  const hasCurrentTimeCue = /(此时|现在|最近|刚刚|刚才|刚|今天|昨天|今晚|早上|中午|下午|晚上)/.test(normalized);
  const hasLifeCue = /(感觉|觉得|心情|情绪|开心|高兴|累|疲惫|焦虑|烦|生气|难受|低落|不舒服|研究|学习|准备|计划|写完|做完|去了|看到|想吃|想喝|吃了|喝了|记录一下|记一下)/.test(
    normalized
  );
  return hasCurrentTimeCue && hasLifeCue;
}

function isCasualConversationRequest(text: string) {
  const normalized = normalizeInput(text);
  if (!normalized) {
    return false;
  }

  if (isReminderCreationRequest(normalized) || isWebSearchRequest(normalized) || isWeatherQuestionRequest(normalized)) {
    return false;
  }

  const asksAboutConversation =
    /(刚才|刚刚|上面|前面|之前|刚说|我说).*(重点|意思|说了什么|聊了什么|记得|还记得|总结|概括)|(?:重点|总结|概括).*(刚才|刚刚|上面|前面|之前|我说)/.test(
      normalized
    );
  const asksToRemember = /(以后|之后|下次|记住|记得).*(这种状态|这个状态|这件事|这句话|我说的|我的状态|我的感受)|(?:帮我)?(?:记住|记一下|记下来).*(状态|感受|心情|偏好|习惯)/.test(
    normalized
  );
  const asksAssistantIdentity = /(你是谁|你叫什么|你是.*谁|你在.*家里.*(角色|身份|算什么)|你.*(角色|身份)|(?:小饭大人|小范大人|饭米粒|豆包).*是谁)/.test(normalized);
  const asksAssistantPersonality = /你.*(性格|脾气|风格)|(?:小饭大人|小范大人|饭米粒|豆包).*(性格|脾气|风格)/.test(normalized);
  const asksAssistantMemory = /你.*(记住|记得|记忆|会记|能记)|(?:小饭大人|小范大人|饭米粒|豆包).*(记住|记得|记忆)/.test(normalized);
  const emotionalShortMessage = /^(我)?(想哭|难受|烦死了|烦|崩溃|不开心|很低落|低落|焦虑|慌|害怕|累死了|好累|孤单|孤独)[。.!！?？]*$/.test(normalized);
  const presenceGreeting = /^(在吗|在不在|有人吗)[。.!！?？]*$/.test(normalized);
  const currentEmotionalState = /(今天|现在|刚刚|刚才).{0,12}(有点累|很累|好累|疲惫|难受|焦虑|烦|不开心|低落)/.test(normalized);
  const conversationalBoundary = /^(算了|不想说了|先不说了|别说了|不聊了|晚点再说|没事了|当我没说)(?:.*不想说了)?[。.!！?？]*$/.test(normalized);
  const openChatCue = /(陪我聊|想聊天|聊聊天|随便聊|听我说|我跟你说|吐槽一下|说两句)/.test(normalized);
  const reflectiveChatCue = /(?:你觉得|想说说话|讲个.{0,8}故事|挺有意思|真有意思|时间过得|云很好看|景色很好看|心情不错)/.test(normalized);
  const locationFollowUp = /^(换成|改成|那)?(丰台|海淀|朝阳|北京|浦东|上海|长安|石家庄)(区|新区)?呢?[。.!！?？]*$/.test(normalized);
  const repairOrRewriteFollowUp = /^(我)?(不是这个意思|不是那意思|不是|不对|你理解错了|你没懂|没懂我的意思|帮我换个说法|换个说法|改写一下|润色一下|重新说)[。.!！?？]*$/.test(
    normalized
  );
  const shortFollowUp =
    normalized.length <= 12 &&
    /^(那|所以|然后|为啥|为什么|怎么说|啥意思|什么意思|不用了|不用|算了|可以|行|好|嗯|哦|那就|那你).*(呢|吗|么|吧)?[。.!！?？]*$/.test(normalized);

  return (
    asksAboutConversation ||
    asksToRemember ||
    asksAssistantIdentity ||
    asksAssistantPersonality ||
    asksAssistantMemory ||
    presenceGreeting ||
    emotionalShortMessage ||
    currentEmotionalState ||
    isFamilyCareStatement(normalized) ||
    conversationalBoundary ||
    openChatCue ||
    reflectiveChatCue ||
    locationFollowUp ||
    repairOrRewriteFollowUp ||
    shortFollowUp
  );
}

export function isUnconfirmedPersonalFactStatement(text: string) {
  const normalized = normalizeInput(text);
  return /^(?:我|本人)(?:不爱吃|爱吃|不喜欢|喜欢|不想吃|想吃|有点担心|担心)/.test(normalized) && !/(?:记一下|记录一下|记住|保存|加入资料)/.test(normalized);
}

export function isShortContextContinuation(text: string, context: AssistantRouteContext) {
  const normalized = normalizeInput(text);
  if (!(context.recentUserTexts?.length || context.recentConversation?.length) || normalized.length > 16) return false;
  if (isTimedTaskStatement(normalized) || isWebSearchRequest(normalized) || isKnowledgeSaveCandidate(normalized, [])) return false;
  if (/(?:创建|新建|添加|加入|提醒|待办|任务|安排|分配|派给|联网搜索|网络搜索|搜一下|查一下)/.test(normalized)) return false;
  if (/(?:人物画像|画像|咋样|怎么样|有什么变化|zuijin|de画像|you谁)|^(?:他|她|爸爸的|妈妈ne)/i.test(normalized)) return false;
  if (/^(?:北京|上海|石家庄|广州|深圳|杭州).{0,8}(?:到|去|往)/.test(normalized)) return false;
  return true;
}

export function isFamilyCareStatement(text: string) {
  const normalized = normalizeInput(text);
  if (!normalized || /[?？]/.test(normalized) || /(?:提醒|任务|待办|安排|保存|记住|记录)/.test(normalized)) return false;
  const mentionsFamilyMember = /(爸爸|老爸|妈妈|老妈|老婆|媳妇|老公|姐姐|老姐|妹妹|哥哥|弟弟|儿子|女儿|闺女|孩子)/.test(normalized);
  const expressesCare = /(辛苦|不容易|操心|劳累|累坏|忙坏|付出很多|心疼|挺累|太累|受累|委屈)/.test(normalized);
  return mentionsFamilyMember && expressesCare;
}

function isAssignmentTaskRequest(text: string, members: FamilyMember[]) {
  const normalized = normalizeInput(text);
  if (!normalized) {
    return false;
  }
  const mentionsMember = members.some((member) => normalized.includes(member.displayName)) || Boolean(resolveMemberAlias(normalized, members));
  const assignmentVerb = /(分给|派给|交给|安排|负责|让).{0,24}(做|处理|打扫|买|取|送|看|完成)?/.test(normalized);
  const explicitMemberTask = /(?:给|帮).{0,12}(?:创建|新建|加|建).{0,12}(?:任务|待办)|(?:创建|新建).{0,20}(?:给|让).{0,10}(?:任务|待办)/.test(normalized);
  return mentionsMember && (assignmentVerb || explicitMemberTask);
}

function isKnowledgeSaveCandidate(text: string, members: FamilyMember[]) {
  const normalized = normalizeInput(text);
  if (!normalized) {
    return false;
  }
  const plain = normalized.replace(/[。.!！?？]+$/, "");
  const mentionsMember = members.some((member) => plain.includes(member.displayName)) || Boolean(resolveMemberAlias(plain, members));
  const hasFactCue = /(喜欢|不喜欢|习惯|偏好|爱吃|不吃|不能吃|过敏|基础病|生日|地址|电话|学校|班级|作息|放在|位于|位置|用药|忌口)/.test(plain);
  const asksToRemember = /(记一下|记录一下|记下来|记住|保存|存一下|加入资料|保存资料)/.test(plain);
  const explicitSaveCommand = /^(?:请)?(?:帮我)?(?:记一下|记下来|记录一下|保存|保存一下|存一下|加入资料|保存资料)(?:[，,：:\s]|$)/.test(plain)
    || /(?:[，,：:\s]|^)(?:记一下|记下来|记录一下|保存|保存一下|存一下|加入资料|保存资料)$/.test(plain)
    || /(?:把|将)(?:前面|上面|刚才|这|那).{0,24}(?:作为)?(?:长期)?(?:资料|记忆)?保存$/.test(plain);
  const substantiveText = plain
    .replace(/^(?:请)?(?:帮我)?(?:记一下|记下来|记录一下|保存|保存一下|存一下|加入资料|保存资料)[，,：:\s]*/, "")
    .replace(/[，,：:\s]*(?:记一下|记下来|记录一下|保存|保存一下|存一下|加入资料|保存资料)$/, "")
    .trim();
  return asksToRemember && ((mentionsMember && hasFactCue) || (explicitSaveCommand && substantiveText.length >= 2));
}

function extractInviteMemberQuery(text: string, members: FamilyMember[]) {
  const normalized = normalizeInput(text);
  const match = normalized.match(/^(?:邀请| invite\s*)(.+)$/i);
  if (!match) {
    return "";
  }
  const query = match[1].trim();
  const matchedMember = members.find((member) => query.includes(member.displayName));
  if (matchedMember) {
    return matchedMember.displayName;
  }
  const aliasMember = resolveMemberAlias(query, members);
  return aliasMember?.displayName || query;
}

function makeRouteContract(input: Partial<AssistantRouteContract> & Pick<AssistantRouteContract, "intent">): AssistantRouteContract {
  const candidateActions = (input.candidateActions || []).filter(isAutomationActionId);
  return {
    actionButtons: input.actionButtons || [],
    candidateActions,
    confidence: typeof input.confidence === "number" ? input.confidence : 1,
    displayTarget: input.displayTarget || "inline_assistant",
    displayType: input.displayType || "chat_reply",
    entities: input.entities || {},
    intent: input.intent,
    reason: input.reason || "",
    requiresConfirmation: input.requiresConfirmation ?? inferRequiresConfirmation(candidateActions),
    summary: input.summary || ""
  };
}

function clarificationRoute(reason: string): AssistantRouteContract {
  return makeRouteContract({
    actionButtons: clarificationButtons(),
    candidateActions: ["app.chat"],
    confidence: 0,
    displayTarget: "inline_assistant",
    displayType: "confirmation_card",
    intent: ["ambiguous"],
    reason,
    requiresConfirmation: false,
    summary: "我不太确定你想怎么处理。"
  });
}

function clarificationButtons(): AssistantRouteActionButton[] {
  return [
    { label: "保存为记录", value: "save_record" },
    { label: "创建任务", value: "create_task" },
    { label: "继续聊", value: "continue_chat" }
  ];
}

function readRouteIntentArray(value: unknown): RouteIntent[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values.filter(isRouteIntent);
}

function isRouteIntent(value: unknown): value is RouteIntent {
  return (
    value === "daily_log" ||
    value === "task" ||
    value === "reminder" ||
    value === "knowledge" ||
    value === "app_answer" ||
    value === "app_chat" ||
    value === "group_chat" ||
    value === "web_search" ||
    value === "profile_describe" ||
    value === "invite" ||
    value === "summary_request" ||
    value === "dangerous" ||
    value === "ambiguous"
  );
}

function readCandidateActions(value: unknown): AutomationActionId[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values
    .map((item) =>
      typeof item === "string"
        ? item
        : item && typeof item === "object" && !Array.isArray(item) && "id" in item
          ? (item as { id?: unknown }).id
          : null
    )
    .filter(isAutomationActionId);
}

function defaultActionForIntent(intent: RouteIntent[]): AutomationActionId | undefined {
  if (intent.includes("dangerous")) return "safety.dangerous_operation";
  if (intent.includes("invite")) return "invite.create";
  if (intent.includes("knowledge")) return "memory.save";
  if (intent.includes("task") || intent.includes("reminder")) return "task.create.input";
  if (intent.includes("profile_describe")) return "profile.describe";
  if (intent.includes("web_search")) return "web.search.duckduckgo";
  if (intent.includes("app_answer")) return "app.answer";
  if (intent.includes("group_chat")) return "group.organize.contextual";
  if (intent.includes("app_chat") || intent.includes("daily_log")) return "app.chat";
  return undefined;
}

function isAutomationActionId(value: unknown): value is AutomationActionId {
  return typeof value === "string" && automationActions.some((action) => action.id === value);
}

function readDisplayTarget(value: unknown): AutomationDisplayTarget | undefined {
  if (
    value === "inline_assistant" ||
    value === "task_list" ||
    value === "resource_list" ||
    value === "group_chat" ||
    value === "modal" ||
    value === "toast" ||
    value === "none"
  ) {
    return value;
  }
  return undefined;
}

function readDisplayType(value: unknown): AutomationDisplayType | undefined {
  if (
    value === "chat_reply" ||
    value === "task_candidate" ||
    value === "task_item" ||
    value === "resource_item" ||
    value === "profile_card" ||
    value === "web_search_result" ||
    value === "confirmation_card" ||
    value === "error_card"
  ) {
    return value;
  }
  return undefined;
}

function readConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readActionButtons(value: unknown): AssistantRouteActionButton[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => {
      const label = readOptionalString(item.label);
      const buttonValue = item.value;
      if (
        !label ||
        (
          buttonValue !== "save_record" &&
          buttonValue !== "create_task" &&
          buttonValue !== "save_knowledge" &&
          buttonValue !== "continue_chat" &&
          buttonValue !== "search_web" &&
          buttonValue !== "app_help" &&
          buttonValue !== "ask_member" &&
          buttonValue !== "provide_input" &&
          buttonValue !== "dismiss"
        )
      ) {
        return null;
      }
      const button: AssistantRouteActionButton = { label, value: buttonValue };
      const queryText = readOptionalString(item.queryText);
      if (queryText) button.queryText = queryText;
      return button;
    })
    .filter((item): item is AssistantRouteActionButton => Boolean(item));
}

function inferRequiresConfirmation(candidateActions: AutomationActionId[]) {
  return candidateActions.some((actionId) => {
    const action = getAutomationAction(actionId);
    return Boolean(action?.requiresConfirmation || action?.sideEffectLevel === "medium" || action?.sideEffectLevel === "high");
  });
}

export function isCollectiveProfileRequest(text: string) {
  const normalized = normalizeInput(text);
  return /(大家|所有人|全部|全员|每个人|每位|所有成员|家庭成员).*(人物画像|画像)|(人物画像|画像).*(大家|所有人|全部|全员|每个人|每位|所有成员|家庭成员)/.test(
    normalized
  );
}

function resolveConfirmedContextualWrite(text: string, context: AssistantRouteContext): AssistantRoute | null {
  const recentUserTexts = (context.recentUserTexts || []).map(normalizeInput).filter(Boolean).slice(-8);
  if (!recentUserTexts.length) {
    return null;
  }

  const previousText = [...recentUserTexts].reverse().find((item) => !isContextOnlyFollowUp(item)) || recentUserTexts.at(-1) || "";

  if (
    previousText &&
    /^(?:这个|那个|这条|刚才的)?(?:帮我)?(?:记住|记着|记一下|记下来|保存)(?:吧|了)?[。.!！?？]*$/.test(text)
  ) {
    return {
      kind: "action",
      id: "memory.save",
      parameters: {
        text: previousText
      }
    };
  }

  return null;
}

export function resolveContextualGroupPlan(
  text: string,
  members: FamilyMember[],
  context: AssistantRouteContext = {},
  now = new Date()
): ContextualGroupPlan | null {
  const normalized = normalizeInput(text);
  const recentConversation = (context.recentConversation || [])
    .map((turn) => ({ role: turn.role, text: normalizeInput(turn.text) }))
    .filter((turn) => turn.text)
    .slice(-12);
  const fallbackConversation = (context.recentUserTexts || [])
    .map((item) => ({ role: "user" as const, text: normalizeInput(item) }))
    .filter((turn) => turn.text)
    .slice(-8);
  const conversation = recentConversation.length ? recentConversation : fallbackConversation;
  const contextText = [...conversation.map((turn) => turn.text), normalized].join("\n");
  const hasPartyContext = /(?:party|patry|派对|聚会)/i.test(contextText);
  const hasSundayContext = /(?:周日|星期日|礼拜日|这个星期天|这周天|下周天|星期天)/.test(contextText);
  if (!hasPartyContext || !hasSundayContext) return null;
  if (/(?:先别|不要|不用|先不|取消|再想想|晚点|以后再).{0,10}(?:建群|组群|群聊|问问|问一下|通知)|(?:建群|组群|群聊|问问|问一下|通知).{0,10}(?:先别|不要|不用|先不|取消|再想想|晚点|以后再)/.test(normalized)) return null;

  const directRequest = /(?:帮我|替我|你来|请你|请)?.{0,6}(?:组|建|创建).{0,20}(?:群|群聊)|(?:群里|群聊里).{0,12}(?:发|问)|(?:帮我|替我|你来|请你).{0,6}(?:问问|问一下|通知|告诉).{0,6}(?:大家|家里|家人|他们|吧)/i.test(normalized);
  const shortConfirmation = /^(?:可以|可以的|行|行的|好|好的|好呀|没问题|就这么办|问问|你帮我问问吧)[。.!！?？~～]*$/.test(normalized);
  const assistantOfferedCoordination = conversation
    .filter((turn) => turn.role === "assistant")
    .slice(-3)
    .some((turn) => /(?:问问|问一下|群里|组群|建群|群聊|通知).{0,12}(?:家里|家人|大家|他们|参加|有空)|(?:家里|家人|大家|他们).{0,12}(?:问问|参加|有空)/.test(turn.text));
  if (!directRequest && !(shortConfirmation && assistantOfferedCoordination)) return null;

  const memberIds = members
    .filter((member) =>
      member.id !== context.actorMemberId &&
      member.relationshipRole !== "guest" &&
      !member.householdRoles?.includes("assistant")
    )
    .map((member) => member.id);
  if (!memberIds.length) return null;

  const sunday = resolveUpcomingSunday(now, /下周(?:日|天)|下个星期(?:日|天)/.test(contextText));
  const dateLabel = `${sunday.getFullYear()}年${sunday.getMonth() + 1}月${sunday.getDate()}日（周日）`;
  const time = extractPartyTime(contextText);
  const location = extractPartyLocation(contextText);
  const food = extractPartyFood(contextText);
  const missingFields: ContextualGroupPlan["missingFields"] = [];
  if (!time) missingFields.push("time");
  if (!location) missingFields.push("location");
  if (!food) missingFields.push("food");
  return {
    details: { date: dateLabel, food, location, time },
    memberIds,
    missingFields,
    title: "周日 Party",
    message: [
      "周日 Party 一起安排一下 🎉",
      "",
      "目前计划：",
      `• 日期：${dateLabel}`,
      `• 时间：${time || "待大家确认"}`,
      `• 地点：${location || "待大家确认"}`,
      "• 主题：家人轻松聚会",
      `• 餐食与饮料：${food || "请大家提议，也可以说说自己方便准备什么"}`,
      "",
      "请大家回复：",
      "1. 是否参加",
      "2. 方便的时间段",
      "3. 想吃什么，或可以负责什么",
      "",
      "人数和时间确认后，我再帮大家整理分工。"
    ].join("\n")
  };
}

function buildContextualGroupDateClarification(text: string, context: AssistantRouteContext): AssistantClarification | null {
  const normalized = normalizeInput(text);
  const conversation = (context.recentConversation || []).slice(-12);
  const contextText = [...conversation.map((turn) => normalizeInput(turn.text)), normalized].join("\n");
  if (!/(?:party|patry|派对|聚会)/i.test(contextText)) return null;
  if (/(?:周日|星期日|礼拜日|星期天|今天|明天|后天|下周|周[一二三四五六]|\d{1,2}月\d{1,2}日)/.test(contextText)) return null;
  const directRequest = /(?:帮我|替我|你来|请你|请)?.{0,6}(?:组|建|创建).{0,20}(?:群|群聊)|(?:帮我|替我|你来|请你).{0,6}(?:问问|问一下|通知|告诉).{0,6}(?:大家|家里|家人|他们|吧)/i.test(normalized);
  const shortConfirmation = /^(?:可以|可以的|行|行的|好|好的|好呀|没问题|就这么办|问问|你帮我问问吧)[。.!！?？~～]*$/.test(normalized);
  const assistantOfferedCoordination = conversation
    .filter((turn) => turn.role === "assistant")
    .slice(-3)
    .some((turn) => /(?:问问|问一下|组群|建群|群聊|通知).{0,12}(?:家里|家人|大家|他们|参加|有空)|(?:家里|家人|大家|他们).{0,12}(?:问问|参加|有空)/.test(turn.text));
  if (!directRequest && !(shortConfirmation && assistantOfferedCoordination)) return null;
  return {
    id: `contextual-group-date-${simpleTextHash(contextText)}`,
    options: [{ label: "补充日期", value: "continue_chat" }],
    originalText: normalized,
    prompt: "这场 Party 准备哪一天举行？告诉我日期后，我就可以组群问大家。",
    round: 1
  };
}

export function resolveFamilyQuestionPlan(
  text: string,
  members: FamilyMember[],
  context: AssistantRouteContext = {}
): FamilyQuestionPlan | null {
  const normalized = normalizeInput(text);
  if (
    /(?:App|软件|功能|怎么使用|如何使用|设置|配置).{0,24}(?:投票|群聊|成员|AI|助手)|(?:投票|群聊).{0,16}(?:怎么使用|如何使用|功能)/i.test(normalized) ||
    /人物画像|画像|联网搜索|网络搜索|上网查|搜索|搜一下|查一下|查下/i.test(normalized)
  ) return null;
  const directAsk = /(?:问问|问一下|问下|问一圈|统计一下|统计|看看|问)(?:\s*(?:大家|家里人|家人|他们|谁))?/.test(normalized);
  const familyCoordination = /(?:谁|大家|家里人|家人|他们|哪些人|多少人|有没有人|回来|回家|吃饭|参加|有空|方便|去不去|要不要|能不能|是否)/.test(normalized);
  if (!directAsk || !familyCoordination) return null;
  if (/(?:问问|问一下|问下).{0,8}(?:你自己|助手|饭米粒).{0,8}(?:怎么|为什么|是什么)/.test(normalized)) return null;
  if (/(?:加入任务|创建任务|记成任务|提醒|待办|分给|派给|交给)/.test(normalized)) return null;

  const eligibleMembers = members.filter((member) =>
    member.id !== context.actorMemberId &&
    member.relationshipRole !== "guest" &&
    !member.householdRoles?.includes("assistant")
  );
  const explicitlyMentioned = eligibleMembers.filter((member) => {
    const aliases = new Set([member.displayName, ...(memberAliasGroups[member.id] || [])]);
    return [...aliases].some((alias) => alias !== "我" && normalized.includes(alias));
  });
  const asksCollectively = /(?:谁|大家|家里人|家人|他们|哪些人|多少人|有没有人)/.test(normalized);
  const memberIds = (asksCollectively || explicitlyMentioned.length === 0 ? eligibleMembers : explicitlyMentioned).map((member) => member.id);
  if (!memberIds.length) return null;

  const temporal = parseTemporalExpression(normalized);
  const dateLabel = temporal.matchedText || temporal.displayText || null;
  const question = normalized
    .replace(/^.*?(?:问问|问一下|问下|问一圈|统计一下|统计|看看|问)\s*(?:一下)?\s*/, "")
    .replace(/[。.!！?？]+$/, "")
    .trim();
  if (!question) return null;

  const topic = /吃饭|吃什么|用餐/.test(question)
    ? "吃饭"
    : /回来|回家/.test(question)
      ? "回家"
      : /参加|去不去/.test(question)
        ? "参加"
        : /有空|方便/.test(question)
          ? "时间"
          : "家庭";
  const title = `${dateLabel || ""}${topic}确认`.replace(/\s+/g, " ").trim();
  return {
    dateLabel,
    memberIds,
    message: `${question}？\n\n请大家直接回复，饭米粒会继续整理结果。`,
    question: `${question}？`,
    title
  };
}

export function resolveMemberKnowledgeQueryPlan(
  text: string,
  members: FamilyMember[],
  context: AssistantRouteContext = {}
): MemberKnowledgeQueryPlan | null {
  const normalized = normalizeInput(text);
  if (!normalized || /人物画像|画像|什么样的人|介绍一下|联网|上网|网络搜索|网页|新闻/.test(normalized)) return null;
  if (!/[?？]|(?:什么|啥|哪|哪里|放哪|几号|几点|什么时候|多大|多少|是否|有没有|在不在|需要什么|想要什么|吗|呢)/.test(normalized)) return null;

  const member = resolveMemberAlias(normalized, members) || [...(context.recentUserTexts || [])]
    .reverse()
    .map((turn) => resolveMemberAlias(turn, members))
    .find((candidate) => candidate && candidate.id !== context.actorMemberId) || null;
  if (!member || member.id === context.actorMemberId || member.relationshipRole === "guest" || member.householdRoles?.includes("assistant")) return null;
  const asksConcreteFamilyFact =
    /(?:喜欢|不喜欢|爱吃|忌口|过敏|吃什么药|用药|医保卡|社保卡|钥匙|证件|放哪|在哪|哪里|生日|纪念日|年龄|年纪|几岁|多大了?|鞋码|衣服|尺寸|几点|什么时候|哪天|周几|有没有空|方便|需要什么|想要什么|想吃什么|家长会|复查|体检)/.test(normalized) ||
    /需要.{0,8}(?:我们|家里|大家)?(?:帮|做).{0,4}什么/.test(normalized);
  const asksAdditionalFactualDetail = /(?:叫什么|为什么没|交了吗|交了没|是多少|手机号|电话|心情怎么样|现在在哪里|几点出门)/.test(normalized);
  if (!asksConcreteFamilyFact && !asksAdditionalFactualDetail) return null;
  if (/(?:怎么办|怎么劝|怎么治|该不该|要不要去医院)/.test(normalized)) return null;

  return {
    memberId: member.id,
    memberName: member.displayName,
    question: normalized
  };
}

function extractPartyTime(text: string) {
  const match = text.match(/(?:周日|星期日|星期天|礼拜日)[^\n。！？]{0,12}?(上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})(?:点(?:(\d{1,2})分?)?|[:：](\d{2}))/);
  if (!match) return null;
  const period = match[1] || "";
  const hour = Number(match[2]);
  const minute = match[3] || match[4];
  return `${period}${hour}点${minute && minute !== "00" ? `${Number(minute)}分` : ""}`;
}

function extractPartyLocation(text: string) {
  const match = text.match(/(?:地点(?:是|定在|：|:)?|(?:party|patry|派对|聚会)[^\n。！？]{0,8}?(?:在|定在))\s*(家里(?:客厅|院子|餐厅)?|家中(?:客厅|院子|餐厅)?|我家(?:客厅|院子|餐厅)?|老妈家(?:客厅|院子|餐厅)?|爸爸家(?:客厅|院子|餐厅)?|[^，。；;\n]{1,12}(?:餐厅|公园|酒店|会所|院子))/i)
    || text.match(/(?:在|定在)\s*(家里(?:客厅|院子|餐厅)?|家中(?:客厅|院子|餐厅)?|我家(?:客厅|院子|餐厅)?|老妈家(?:客厅|院子|餐厅)?|爸爸家(?:客厅|院子|餐厅)?|[^，。；;\n]{1,12}(?:餐厅|公园|酒店|会所|院子))[^\n。！？]{0,8}?(?:办|举行|聚会|party|patry)/i);
  return match?.[1]?.trim() || null;
}

function extractPartyFood(text: string) {
  const match = text.match(/(?:准备吃|想吃|餐食(?:是|定为|：|:)?|吃)\s*(火锅|烧烤|烤肉|披萨|饺子|家常菜|自助餐|蛋糕)/);
  return match?.[1] || null;
}

function resolveUpcomingSunday(now: Date, forceFollowingWeek: boolean) {
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let daysAhead = (7 - sunday.getDay()) % 7;
  if (daysAhead === 0) daysAhead = 7;
  if (forceFollowingWeek) daysAhead += 7;
  sunday.setDate(sunday.getDate() + daysAhead);
  return sunday;
}

function resolveContextualAppAnswer(text: string, context: AssistantRouteContext): AssistantRoute | null {
  if (context.dialogueState?.activeQueryType !== "records.recent") {
    return null;
  }
  const recordDate = readRecordDate(text);
  if (!recordDate) {
    return null;
  }
  return {
    kind: "action",
    id: "app.answer",
    parameters: {
      queryType: "records.recent",
      recordDate,
      text
    }
  };
}

function readRecordDate(text: string) {
  const parsed = parseTemporalExpression(text, new Date(), "Asia/Shanghai", "record");
  return parsed.precision === "date" || parsed.precision === "minute" ? parsed.occurredOn : undefined;
}

function hasAnyTerm(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

export function advanceAssistantDialogueState(
  previous: AssistantDialogueState | undefined,
  route: AssistantRoute
): AssistantDialogueState | undefined {
  if (route.kind === "action" && route.id === "app.answer" && route.parameters.queryType === "records.recent") {
    return {
      activeQueryType: "records.recent",
      recordDate: route.parameters.recordDate,
      remainingFollowUps: 2
    };
  }
  if (!previous || previous.remainingFollowUps <= 1) {
    return undefined;
  }
  return {
    ...previous,
    remainingFollowUps: previous.remainingFollowUps - 1
  };
}

function profileRoute(member: string, text: string): AssistantRoute {
  return {
    kind: "action",
    id: "profile.describe",
    parameters: {
      member,
      text
    }
  };
}

function isContextOnlyFollowUp(text: string) {
  return /^(?:这个|那个|这条|刚才的)?(?:帮我)?(?:记住|记着|记一下|记下来|保存)|^(?:那|所以|然后|为啥|为什么|咋办|怎么办|不是|不对|算了)/i.test(text);
}

function resolveMemberAlias(text: string, members: FamilyMember[]) {
  const matches = members.flatMap((member) => {
    const aliases = new Set([member.displayName, ...(memberAliasGroups[member.id] || [])]);
    return [...aliases]
      .filter((alias) => text.includes(alias))
      .map((alias) => ({
        alias,
        member,
        score: alias === "我" || alias === "本人" ? 0 : alias === member.displayName ? 3 : 2
      }));
  });
  return matches.sort((left, right) =>
    right.score - left.score ||
    right.alias.length - left.alias.length ||
    text.lastIndexOf(right.alias) - text.lastIndexOf(left.alias)
  )[0]?.member || null;
}

function normalizeInput(text: string) {
  return text
    .trim()
    .replace(/^\/+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripCorrectionPrefix(text: string) {
  const corrected = text.replace(
    /^(?:(?:不是(?:这个|那个|这样)|不对|搞错了|我说错了)[，,。.!！\s]*)+(?:(?:其实)?我(?:是)?想(?:要)?|应该是)[：:\s]*/,
    ""
  ).trim();
  return corrected || text;
}
