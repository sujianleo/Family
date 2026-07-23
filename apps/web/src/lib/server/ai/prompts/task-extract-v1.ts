import type { BaseMessageLike } from "@langchain/core/messages";
import { assignmentSuggestionJsonSchema } from "../../../aiSchema";

export type TaskExtractInput = {
  contextTab: string;
  members: Array<{
    displayName: string;
    id: string;
    profile: unknown;
    relationshipRole?: string;
  }>;
  mentionedMemberIds: string[];
  senderMemberId: string;
  text: string;
};

export function buildTaskExtractMessages(input: TaskExtractInput): BaseMessageLike[] {
  return [
    {
      role: "system",
      content: `task-extract-v1
你是家庭协作 App 的任务字段提取器，只负责生成候选，不执行任务。
必须严格符合以下 Schema：只允许这些字段，字段不可缺失，不要输出额外字段。
${JSON.stringify(assignmentSuggestionJsonSchema, null, 2)}
规则:
1. mentioned_member_ids 非空时优先使用这些成员。
2. context_tab 为 "待办" 时，如果内容只是用户自己的个人事项，suggested_assignee_ids 必须只返回 sender_member_id。
3. 如果内容明确提到某个人名或 @成员，再派给对应成员；没有明确对象时返回 sender_member_id。
4. 不要使用写死的人物标签。只有当 profile 或输入文本本身提供证据时，才能在 reason 中说明依据。
5. 同意/不同意类为 approval；需要对方填写文字为 input；需要选择多个项目为 multiple_choice。
6. multiple_choice 必须根据文本拆解出 2-8 个短选项。
7. “谁愿意/谁想/谁可以/有没有人/大家谁有空”这类开放报名问题是 approval，suggested_assignee_ids 返回除 sender 外的所有核心成员，task_options 返回 ["愿意","不愿意"]。
8. 从任务文本里提取时间到 display_time；task_title 不要包含这段时间。
9. 如果只是发起人自己的任务或没有明确对象，personal_todo 返回 true，suggested_assignee_ids 返回 sender_member_id。
10. approval 和 input 的 task_options 可以返回 []。
11. requiresConfirmation 由 App 的 Action 合同决定；你不能声称已经创建任务。
12. 只返回合法 JSON，不要 markdown。`
    },
    {
      role: "user",
      content: JSON.stringify({
        context_tab: input.contextTab,
        members: input.members,
        mentioned_member_ids: input.mentionedMemberIds,
        sender_member_id: input.senderMemberId,
        text: input.text
      })
    }
  ];
}
