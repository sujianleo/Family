# 我爱饭米粒系统架构

本文描述公开源码的当前整体架构、关键数据流和扩展边界。它面向部署者、贡献者和需要审计 AI 行为的开发者。

## 1. 架构目标

系统要同时满足四件事：

1. **记录足够简单**：家庭成员可以用自然语言、附件和结构化页面快速记录；
2. **数据能够积累**：任务、聊天、资料和事件进入可回看的家庭时间线；
3. **AI 受约束**：模型只做识别、提取、总结和建议，不能成为自主控制器；
4. **操作可以追溯**：保留原始输入、AI 解释、执行过程和最终显示结果。

系统明确不追求：

- 自主 Agent 循环；
- 模型自由选择工具；
- 模型直接修改数据库；
- 无确认的多步副作用执行；
- 用 AI 摘要覆盖原始事实。

## 2. 系统上下文

![系统上下文](assets/system-context-mobile.png)

[Mermaid 源文件](system-context-mobile.mmd)

主要运行单元：

| 单元 | 责任 |
| --- | --- |
| 浏览器 / PWA | 页面、输入、缓存、通知权限和结构化结果展示 |
| Next.js Route Handlers | 身份校验、输入校验、业务 API 和服务端执行入口 |
| TypeScript 业务核心 | 路由、Action/Pipeline、确认、事件、总结、资料和通知逻辑 |
| Supabase | 生产数据库、认证、对象存储和家庭范围数据 |
| 本地 `data/` | 本机体验、文件回退和调试镜像；必须持久化 |
| 可选 AI 服务 | 受约束的识别、提取、总结、建议和语音转写 |

认证后的 Route Handler 先从访问令牌解析 `familyId` 与 `memberId`，再读取该家庭的真实成员。手动选择的成员 ID 会先验证归属；任务路由不能用演示成员替换真实账号，也不能把其他家庭成员写成负责人。

## 3. 四层应用架构

```text
UI Layer
  ↓
Intent / Display Layer
  ↓
Action / Pipeline Layer
  ↓
Data Layer
```

### 3.1 UI Layer

负责页面与用户交互：

- 家庭主页、任务、群组、资料和记录；
- 输入框、附件、语音和移动端键盘适配；
- inline assistant、候选卡、确认卡、toast、modal 和 bottom sheet；
- 设置、通知、邀请、访客与 PWA 安装。

关键文件：

- `apps/web/src/app/page.tsx`
- `apps/web/src/components/family-hub-page.tsx`
- `apps/web/src/components/record-list.tsx`
- `apps/web/src/components/settings-drawer.tsx`
- `apps/web/src/components/notification-center.tsx`
- `apps/web/src/components/pwa-install-prompt.tsx`

UI 只消费结构化结果。它不应解析模型自由文本来判断“这是任务还是资料”。

### 3.2 Intent / Display Layer

负责判断：

- 用户想做什么；
- 是否需要澄清或确认；
- 候选 Action/Pipeline 是什么；
- 结果显示到哪里；
- 使用哪一种结构化卡片。

关键文件：

- `apps/web/src/lib/assistantRouter.ts`
- `apps/web/src/lib/taskIntent.ts`
- `apps/web/src/lib/composerIntent.ts`
- `apps/web/src/lib/automations.ts`
- `apps/web/src/lib/server/assistantChain.ts`
- `apps/web/src/app/api/assistant-route/route.ts`

推荐显示映射：

| 结果 | `display.target` | 示例 |
| --- | --- | --- |
| 临时回答 | `inline_assistant` | 普通问答、画像预览、澄清 |
| 任务候选 | `task_list` | 创建任务、提醒 |
| 长期资料 | `resource_list` | 保存文件、家庭知识 |
| 群聊结果 | `group_chat` | 群消息、投票结果 |
| 轻量反馈 | `toast` | 已保存、已更新 |
| 高影响确认 | `modal` 或确认卡 | 邀请、删除、权限变化 |

未知结果安全回退到 `inline_assistant`，不能默认塞进任务列表。

### 3.3 Action / Pipeline Layer

Action 是单个白名单能力；Pipeline 是预先定义的 Action 顺序。

关键文件：

- `apps/web/src/lib/automationRegistry.ts`
- `apps/web/src/lib/automationSchemas.ts`
- `apps/web/src/lib/server/automationRunner.ts`
- `apps/web/src/lib/server/confirmationGate.ts`
- `apps/web/src/app/api/automation-actions/route.ts`

Action 合同包含：

- ID 与描述；
- 输入 Schema；
- 是否需要确认；
- 副作用等级；
- 结构化输出与显示目标；
- 确定性执行函数。

Pipeline 只能组合注册表中已知步骤。模型可以推荐一个 Action/Pipeline，但不能在运行时自由创造新的工具链。

### 3.4 Data Layer

负责正式数据、原始文件、身份和审计记录。

关键文件：

- `supabase/schema.sql`
- `apps/web/src/lib/supabase.ts`
- `apps/web/src/lib/server/supabaseServer.ts`
- `apps/web/src/lib/server/familyRequestContext.ts`
- `apps/web/src/lib/server/eventStore.ts`
- `apps/web/src/lib/server/tusUploadServer.ts`

生产环境以 Supabase 为主线。本地文件模式需要显式启用 `FAMILY_APP_ALLOW_FILE_FALLBACK`，并持久化完整 `data/`。

## 4. 一条自然语言输入怎样执行

![自然语言输入执行链](assets/assistant-execution-mobile.png)

[Mermaid 源文件](assistant-execution-mobile.mmd)

路由顺序强调确定性优先：

1. 危险操作检测；
2. 本地规则；
3. Registry alias 匹配；
4. 可选模型路由；
5. 安全的澄清、问答或任务候选回退。

## 5. LangChain 集成

当前 LangChain 主要用于三类受约束任务：

1. **路由增强**：本地规则无法高置信度判断时，补充识别候选 Action；
2. **结构化生成**：任务提取、总结、画像、记忆候选等返回 JSON；
3. **带依据问答**：把经过筛选的家庭证据交给模型生成简短回答。

关键文件：

- `apps/web/src/lib/server/langchainAi.ts`
- `apps/web/src/lib/server/langchainTools.ts`
- `apps/web/src/lib/server/assistantChain.ts`
- `apps/web/src/lib/server/ai/models.ts`
- `apps/web/src/lib/server/ai/chains/`
- `apps/web/src/lib/server/ai/prompts/`
- `apps/web/src/lib/server/ai/schemas/`

### 5.1 当前模型适配

当前结构化聊天链使用 `@langchain/openai` 的 `ChatOpenAI` 兼容客户端，配置 DeepSeek 的 OpenAI-compatible `baseURL`：

```text
LangChain ChatOpenAI adapter
       ↓
DEEPSEEK_BASE_URL
       ↓
fast model / deep model
       ↓
JSON response
       ↓
Zod Schema validation
```

- fast 模型用于路由、短提取和低延迟回答；
- deep 模型用于更复杂的总结和整理；
- 调用时记录模型、操作、耗时、token 和失败信息；
- Schema 校验失败时不能把自由文本当作有效业务结果。

当前 `OPENAI_API_KEY` 的明确服务端用途是语音转写；结构化聊天主链仍以 DeepSeek 为主。要把 OpenAI Chat 模型接入同一条聊天链，应新增明确的 Provider adapter，而不是只在设置界面增加一个名称。

### 5.2 LangChain Tools 不是自由工具箱

`langchainTools.ts` 只暴露有限白名单：

- `family_app_answer` → `app.answer`
- `family_app_chat` → `app.chat`
- `family_profile_describe` → `profile.describe`
- `family_web_search_duckduckgo` → `web.search.duckduckgo`

当前 Pipeline tool 列表为空。Tool 输入先经过危险操作检测，再进入已有 `automationRunner`；LangChain tool 不能绕过 Action Registry、确认规则和事件审计。

### 5.3 路由 Shadow 与缓存

`assistantChain.ts` 先运行确定性本地路由。只有 fallback、低置信度或依赖对话上下文时才调用模型路由。

模型路由结果还会：

- 与受保护的本地路由规则合并；
- 使用家庭上下文哈希和 prompt 版本缓存；
- 记录 shadow disagreement，便于比较本地规则与模型建议；
- 禁止覆盖危险操作、明确时间任务等受保护结果。
- 禁止覆盖用户在输入框中手动选择的任务负责人。

LangChain 在这里是“受约束的增强层”，不是系统总调度器。

## 6. RAG：家庭证据检索与有依据回答

当前 RAG 是家庭范围内的只读证据检索，不是“把全部数据扔进模型”。它也没有使用向量数据库或 embedding；当前实现采用来源规划、关键词扩展、来源权重和时效排序。

关键文件：

- `apps/web/src/lib/server/trustedAssistantContext.ts`
- `apps/web/src/lib/server/summarySourceBuilder.ts`
- `apps/web/src/lib/server/automationRunner.ts`
- `apps/web/src/lib/server/conversationMemory.ts`
- `apps/web/src/lib/server/resourceInsights.ts`

### 6.1 RAG 执行链

![家庭检索与回答链](assets/rag-pipeline-mobile.png)

[Mermaid 源文件](rag-pipeline-mobile.mmd)

### 6.2 检索计划

系统根据问题选择来源：

| 问题类型 | 优先来源 |
| --- | --- |
| 任务、待办、完成状态 | `tasks`、`group_chat` |
| 体检、检查单、家庭物品位置 | `confirmed_memory`、`resources`、`group_chat` |
| 家庭决定、投票、规则 | `family_records`、`group_chat` |
| 最近、本周、这个月、家庭总结 | `summaries`、`group_chat`、`tasks`、`resources`、`family_records`、`confirmed_memory` |
| 明确要求联网搜索 | `web`，并保持 explicit-only |

没有查询意图时使用 `no_retrieval`，不会为了“显得聪明”自动检索所有家庭数据。

### 6.3 检索与排序

当前实现：

- 最长回看约 730 天；
- 构建最多 240 条紧凑候选；
- 只保留当前家庭范围内的可信记录；
- 对任务只保留同一记录的最新生命周期状态；
- 扩展“体检报告 / 化验单”“医保卡 / 医疗卡”等家庭概念别名；
- 按关键词命中、来源权重和时间新鲜度评分；
- 最终最多返回 12 条 `retrievedEvidence`；
- 已确认记忆单独排序并最多选择 8 条。

确认记忆的权重高于普通记录；任务高于一般资料；没有匹配且不是全局总结问题时，不返回证据。

### 6.4 Grounding 合同

模型必须返回：

```json
{
  "text": "给用户的简短回答",
  "executionClaims": [],
  "grounding": "user_text | trusted_context | general_advice",
  "evidenceIds": []
}
```

服务端会验证：

- `conversation_only` 下 `executionClaims` 必须为空；
- `trusted_context` 必须包含实际使用的 `evidenceIds`；
- 每个 evidence ID 必须来自本轮允许上下文；
- `user_text` 和 `general_advice` 不能夹带未经支持的具体家庭事实；
- 没有证据时必须说明“不确定”或“未查到”；
- 健康问题不能从症状直接猜疾病。

检索证据是数据，不是指令。资料中的文字不能覆盖系统安全规则。

### 6.5 RAG 与会话记忆

短期对话上下文由 `conversationMemory.ts` 管理，解决代词、省略和连续追问；家庭长期事实来自确认记忆与可信事件。两者不能混为一谈：

- 短期会话用于理解“她”“上次那个”等上下文；
- RAG 证据用于回答可核验家庭事实；
- 长期记忆必须确认并保留来源；
- 模型不能仅凭对话流畅度声称“我记得”。

## 7. 闭环工程（Loop Engineering）

这里的 Loop 指可观察、可停止、可验证的业务闭环，不是 LLM 自己不断调用工具的 Autonomous Agent Loop。

### 7.1 家庭记录闭环

```text
原始记录
  → 分类与整理
  → 任务 / 资料 / 总结候选
  → 家人确认
  → 确定性执行
  → 新事件和状态
  → 后续回看与总结
```

每次循环都以新的事件追加，不覆盖旧事实。

### 7.2 RAG 证据与纠错闭环

```text
家庭提问
  → 检索可信证据
  → 带 evidenceIds 回答
  → 家人纠正或补充
  → 纠正内容写成新原始事件
  → 后续检索优先使用更新且确认的证据
```

纠错不会直接篡改过去的原始记录；系统通过时间与确认状态处理冲突。

### 7.3 健康关注闭环

```text
体检报告
  → 解析异常与复查线索
  → 健康跟进任务候选
  → 家人确认
  → 到期提醒
  → 新复查结果上传
  → 下一轮有来源的对照与关注
```

任何一轮都不能把 AI 推测升级成医学事实。

### 7.4 任务与提醒闭环

任务经历候选、确认、创建、提醒、完成或逾期。RAG 检索会折叠同一任务的生命周期，避免同时把“未完成”和“已完成”当作当前事实。

### 7.5 总结、画像和记忆质量闭环

```text
可信事件集合
  → 结构化生成
  → Schema 与 sourceIds 校验
  → 展示候选
  → 人工确认或修正
  → 保存派生结果
  → 后续重新生成与质量比较
```

路由 shadow、API usage、错误原因和独立测试用于观察每一轮质量。失败结果不进入正式事实层。

### 7.6 为什么这不是自主 Agent Loop

系统禁止：

```text
LLM 选择工具 → 执行 → LLM 观察 → 再选工具 → 无限继续
```

允许的是：

```text
状态机 / Scheduler 触发
  → 一个白名单 Action 或预定义 Pipeline
  → 校验与确认
  → 确定性执行
  → 写审计事件
  → 结束本轮
```

每一轮都有明确触发者、允许动作、终止条件和审计记录。

## 8. 确认与副作用控制

以下操作原则上需要确认：

- 创建任务或提醒；
- 保存长期家庭知识；
- 创建邀请或修改成员；
- 删除、归档、批量修改；
- 修改权限；
- 代表用户发送群消息；
- 生成或公开敏感健康总结。

确认流程使用服务端签名 token。浏览器再次提交时，原始参数必须与签名内容匹配。仅在前端显示一个“确认”按钮，不等于完成安全确认。

危险的删除、清空、重置等输入应进入 `safety.dangerous_operation`，默认返回安全解释，而不是立即执行。

## 9. 事件与时间线

核心原则：

```text
raw_events
  → assistant_interpretations
  → automation_runs
  → summaries / profiles / memories / business outputs
```

| 数据 | 含义 | 能否被 AI 结果覆盖 |
| --- | --- | --- |
| `raw_events` | 用户原话、上传、群聊、系统事件 | 不能 |
| `assistant_interpretations` | 意图、候选能力、置信度和说明 | 可以重新生成 |
| `automation_runs` | 执行输入、状态、副作用、错误和输出 | 追加审计，不覆盖原事件 |
| `summaries` | 日、周、月或自定义总结 | 可以重新生成 |
| profiles / memories | 画像和长期记忆派生结果 | 必须保留来源和确认状态 |

相关 Supabase 表包括：

- `raw_events`
- `assistant_interpretations`
- `automation_runs`
- `summaries`
- `api_usage`
- `knowledge_inquiries`

本地文件模式会在 `data/` 中写入 JSONL 或状态文件。它们既是运行数据，也是备份范围的一部分。

## 10. 任务、群聊、资料和家庭决定

### 任务

自然语言先解析为任务候选，再由 Action 创建正式记录。成员、时间和任务类型必须通过 Schema 与业务规则校验。

### 群聊

群聊消息、附件和临时访客由独立 API 管理。重要聊天可以通过预定义 Pipeline 整理为资料，但长期保存需要确认。

### 资料

上传原件与派生预览分离：

- 原始文件用于追溯；
- 压缩预览用于移动端展示；
- 缩略图用于列表；
- 文档解析与 OCR 属于派生处理。

### 家庭决定与评评理

家庭决定、候选项、参与者、投票和讨论使用独立数据结构。结果总结不影响原始选票；将结果转成任务时仍需要确认。

相关表包括：

- `family_decisions`
- `family_decision_options`
- `family_decision_participants`
- `family_decision_ballots`
- `family_decision_messages`
- `family_judgements`
- `family_judgement_stances`

## 11. 资料解析与健康关注链路

![资料解析与健康关注链](assets/resource-insight-mobile.png)

[Mermaid 源文件](resource-insight-mobile.mmd)

关键文件：

- `apps/web/src/app/api/resource-insights/route.ts`
- `apps/web/src/lib/server/resourceInsights.ts`
- `apps/web/src/lib/server/trustedAssistantContext.ts`
- `apps/web/src/lib/server/documentThumbnail.ts`
- `apps/web/src/lib/server/officeDocumentPreview.ts`

健康结论必须：

- 关联原始文件或原始事件；
- 标记敏感类别；
- 区分原文、提取和推测；
- 需要确认后才能进入长期知识或任务；
- 明确不构成医疗诊断。

## 12. 总结、画像和长期记忆

### 总结

`deepSummary.ts` 和 `summarySourceBuilder.ts` 构建个人或家庭时间范围内的来源，再写入 `summaries`。总结失败不应删除或修改原始事件。

### 画像

`memberProfiles.ts` 根据可信来源生成或刷新成员画像。`aiSchema.ts` 要求画像字段和证据匹配，避免没有证据的健康或身份断言。

### 长期记忆

长期记忆只适合稳定、重复、对未来有用的信息。`memory.extract.family` 负责提出候选，`memory.save` 负责确认后的保存。临时情绪和单次聊天不应自动进入长期记忆。

## 13. 后台调度

Node.js 运行时通过 `apps/web/src/instrumentation.ts` 启动：

- 本地通知派发器；
- `assistantScheduler`；
- 后台家庭整理调度器。

调度器只允许执行 `schedulableActionIds` 白名单中的动作，例如：

- `assistant.suggest.next`
- `member.knowledge.followup`
- `background.organize.daily`
- `meta.summary.daily`
- `meta.summary.weekly`
- `meta.summary.monthly`

内置周期包括周总结和月总结；运行状态保存在持久化数据目录。调度器不能借机执行任意模型工具，也不能绕过 Action 执行器。

部署注意：如果容器只启动前端静态资源而没有持续运行 Node.js 服务端，后台调度和本地通知派发不会工作。

## 14. 认证、家庭范围与访客隔离

### 正式成员

生产环境建议启用：

- `NEXT_PUBLIC_FAMILY_APP_AUTH_REQUIRED=true`
- `FAMILY_APP_AUTH_REQUIRED=true`

服务端通过 `familyRequestContext.ts` 校验会话、家庭归属和成员身份。请求体中的 `family_id` 或 `actor_member_id` 不能作为授权依据。

### 家庭邀请

邀请包含链接、4 位验证码、有效期和使用限制。注册后还需要管理员确认，之后账号才会绑定家庭成员。

相关表：

- `invites`
- `invite_acceptances`
- `family_join_requests`
- `family_relationships`

### 临时群聊访客

访客会话只允许访问指定群聊和群文件。它不能读取家庭资料、画像、历史事件和长期记忆。访客上传、会话 Secret 与家庭正式会话分离。

## 15. 通知架构

![通知投递链](assets/notification-pipeline-mobile.png)

[Mermaid 源文件](notification-pipeline-mobile.mmd)

相关表：

- `notification_preferences`
- `notification_endpoints`
- `notifications`

相关文件：

- `apps/web/public/sw.js`
- `apps/web/src/lib/server/notificationStore.ts`
- `apps/web/src/lib/server/localNotificationDispatcher.ts`
- `apps/web/src/components/notification-center.tsx`

系统通知需要 HTTPS、浏览器权限、VAPID 和有效订阅。页面内提醒与后台 Web Push 是两条不同的验证链路。

## 16. 存储模式

### Supabase 模式

适合正式多设备家庭：

- Postgres 保存结构化数据；
- Storage 保存原始文件；
- Auth 提供账号会话；
- RLS 与服务端上下文限制家庭范围。

### 本地文件模式

适合本机体验或轻量自托管：

- 通过 `FAMILY_APP_ALLOW_FILE_FALLBACK=true` 显式启用；
- `data/` 包含事件、任务、上传、预览、调度状态和通知状态；
- Docker 应挂载完整 `/app/data`；
- 备份必须覆盖整个 volume。

本地文件模式不是浏览器 `localStorage`，而是服务器端持久化目录。

## 17. AI Provider 边界

支持的主要环境配置：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL_FAST`
- `DEEPSEEK_MODEL_DEEP`
- `OPENAI_API_KEY`
- `OPENAI_TRANSCRIBE_MODEL`

Provider 选择不会改变安全合同。无论模型来自哪里，都必须：

- 返回受约束的结构化结果；
- 只选择候选白名单；
- 通过 Schema 校验；
- 接受权限和确认规则；
- 不直接访问数据库凭据。

模型 API Key 只能保存在服务端环境或受保护配置中。

## 18. 部署拓扑

### 单机 Docker

```text
Browser / PWA
      ↓ HTTPS / reverse proxy
Next.js Node container
      ↓
Persistent /app/data volume
      ↘ optional Supabase / AI / Web Push
```

### Supabase 生产部署

```text
Browser / PWA
      ↓
Next.js Node service
      ├─ Supabase Auth
      ├─ Supabase Postgres
      ├─ Supabase Storage
      ├─ Notification dispatcher
      └─ Optional DeepSeek / OpenAI / Speech
```

生产环境必须同时验证：

- 登录和家庭成员归属；
- 上传与原件访问；
- Secret 和确认 token；
- 数据持久化和恢复；
- PWA 安装与缓存；
- Web Push 的服务器到设备链路；
- 后台调度在重启后继续工作。

## 19. 扩展一个新能力

新增 AI 相关能力前，依次回答：

1. 它是确定性 App 功能，还是正在变成自主 Agent？
2. 是否有注册的 Action 或预定义 Pipeline？
3. 输入和输出是否有 Schema？
4. 副作用等级是什么？
5. 是否需要确认？
6. 显示目标和卡片类型是什么？
7. 是否记录 raw event、interpretation 和 automation run？
8. 是否保留原始输入和原始文件？
9. 是否有家庭范围授权？
10. 是否有独立测试覆盖路由、确认和失败路径？

如果能力要求模型自由规划、自由选择工具或直接修改正式数据，应停止并重新设计。

## 20. 代码地图

| 领域 | 主要位置 |
| --- | --- |
| 页面与 UI | `apps/web/src/app/`、`apps/web/src/components/` |
| 意图和显示 | `assistantRouter.ts`、`taskIntent.ts`、`composerIntent.ts` |
| Action/Pipeline | `automationRegistry.ts`、`automationSchemas.ts` |
| 服务端执行 | `server/automationRunner.ts`、`confirmationGate.ts` |
| 事件与总结 | `eventStore.ts`、`deepSummary.ts`、`summarySourceBuilder.ts` |
| 资料解析 | `resourceInsights.ts`、`trustedAssistantContext.ts` |
| 成员画像 | `memberProfiles.ts`、`aiSchema.ts` |
| 后台调度 | `assistantScheduler.ts`、`backgroundOrganizer.ts` |
| 通知 | `notificationStore.ts`、`localNotificationDispatcher.ts`、`public/sw.js` |
| 身份与邀请 | `familyRequestContext.ts`、`inviteAccess.ts`、`guestChatAccess.ts` |
| 数据库 | `supabase/schema.sql` |

继续阅读：[使用手册](user-guide.md)、[能力矩阵](capability-matrix.md)、[Action Pipeline 数据流](action-pipeline-flow.mmd)。
