# Family App Capability Matrix

| Module | Label | Intents | Actions / Pipelines | Batch | Key Parameters | Notes |
|---|---|---|---|---|---|---|
| `family.members` | 家庭成员 | `members.list`, `members.online`, `profile.describe`, `member.rename` | `app.answer`, `member.rename`, `profile.describe` | no | `query_type`, `member`, `new_name`, `text` | 家庭成员列表、在线状态、成员画像、成员别名解析和自然语言改名 |
| `tasks` | 任务 | `task.create.open_volunteer`, `task.create.health_followup`, `task.create.direct_assignment`, `task.create.personal_todo`, `tasks.outgoing`, `tasks.incoming`, `tasks.pending` | `task.create.approval`, `task.create.input`, `task.create.multiple_choice`, `pipeline.task.ai_create` | no | `task_kind`, `task_action_type`, `assignee_scope`, `assignee_ids`, `health_subject`, `options`, `title`, `text` | 创建任务、开放报名、健康跟进、直接指派、个人待办和任务状态查询 |
| `groups` | 群组 | `group.create`, `group.create.batch`, `group.list`, `group.rename` | `group.create` | yes, max 10, confirm | `count`, `title`, `audience`, `text` | 创建群、批量创建群、群名解析、邀请链接和群聊消息入库 |
| `resources` | 资料 | `resources.list`, `resource.save`, `resource.upload`, `resource.sync_from_chat` | `app.answer`, `pipeline.chat.save_to_library` | no | `query_type`, `source_message_id`, `files`, `text` | 资料库查询、附件保存、群聊内容同步资料 |
| `records` | 记录 | `records.recent`, `record.search`, `record.delete`, `record.archive` | `app.answer` | no | `query_type`, `record_id`, `text` | 最近记录查询、记录搜索、删除和归档 |
| `safety` | 安全 | `safety.dangerous_operation`, `data.delete.all`, `data.reset`, `record.delete.bulk` | `safety.dangerous_operation` | no | `text`, `risk_level`, `reason` | 识别删除、清空、重置等高危输入，隔离执行链路并返回未执行说明 |
| `meta` | Meta | `meta.summary.daily`, `meta.summary.weekly`, `meta.summary.monthly`, `meta.profiles.refresh`, `meta.profile_learning` | `meta.summary.daily`, `meta.summary.weekly`, `meta.summary.monthly`, `meta.profiles.refresh`, `pipeline.meta.daily_rollup`, `pipeline.meta.profile_learning` | no | `period`, `text` | 人物画像学习、每日总结、每周总结和每月总结 |
| `app.answer` | APP 问答 | `app.answer` | `app.answer` | no | `query_type`, `text` | 内部数据问答的兼容入口，负责把 query_type 转给具体模块 |
