<h3 align="center">
  <img src="apps/web/public/family-logo-v2.png" alt="我爱饭米粒" width="120" />
</h3>

<p align="center">
  <img alt="Self-hosted" src="https://img.shields.io/badge/SELF--HOSTED-2F6F68?style=flat-square" />
  <img alt="AI optional" src="https://img.shields.io/badge/AI-OPTIONAL-1E514C?style=flat-square" />
  <img alt="PWA" src="https://img.shields.io/badge/PWA-6C717C?style=flat-square" />
</p>

---

# 我爱饭米粒

**用心记录 守护家庭。** 沿时间整理家事、健康资料与家庭协作。

不是微信，不是对话机器人，更不是 OS。家里不缺一个新群，缺的是有人把事情记住。

---

## 为什么是饭米粒？

- **父母健康**：收好体检报告与复查安排，经过授权随时关注。
- **家庭协作**：提醒、任务和约定有人接住，不再反复翻群聊。
- **长期记录**：今天随手记，明天找得到。
- **家人做主**：AI 可以理解和建议，重要决定始终归家人。

## 一件家事，怎样被好好接住？

1. **随手记录** — 任务、语音、文件。

2. **进入家庭时间线** — 记清什么时候、谁、什么事。

3. **AI 整理** — 检索、总结、寻找依据。

4. **家人确认** — 重要决定不交给模型。

5. **提醒与跟进** — 今天做完，明天仍然记得。

## Quick Start

### Docker Compose（完整家庭部署）

准备 Docker Compose 2.20 或更高版本、Git 和 OpenSSL。进入项目目录后，首次部署只运行：

```bash
./start.sh
```

`start.sh` 会识别局域网地址、生成独立密钥、下载固定版本的官方 Supabase Compose 配置、构建应用、启动全部容器并自动建表。根目录的 `docker-compose.yml` 会把饭米粒、PostgreSQL、Auth、API 和文件存储纳入**同一个 Compose 项目**。安装者不需要单独运行 `scripts/setup-local-supabase.sh`，也不需要手填 URL 或 Key。

> 全新下载的项目还没有 `.runtime/local-supabase`，所以第一次不要直接执行 `docker compose up`；先运行一次 `./start.sh`。Supabase 由多个职责独立的容器组成，但都属于这一套 Compose，不是塞进饭米粒应用容器。

首次初始化完成后，整套服务可以统一管理：

```bash
docker compose ps
docker compose stop
docker compose up -d
```

打开终端显示的地址；第一次进入时创建家庭管理员。管理员可以继续邀请家人，每位家人使用自己的账号申请加入，管理员确认后才进入同一个家庭空间；群聊、定向任务、完成反馈和资料会在家庭成员之间同步。

如果 NAS 有多个网卡，可明确指定：

```bash
FAMILY_APP_HOST=192.168.1.20 ./start.sh
```

同一局域网中的手机和电脑都能访问。应用从局域网地址打开时自动连接同一台 NAS 的 Supabase；从公网域名打开时使用单独配置的公网 HTTPS 地址。详细配置见[本地 Supabase 部署](docs/self-hosted-supabase.md)。

公网地址可以留空。设置中的“自动”模式会分别检测可用连接并选择更快的一条；局域网地址来自构建环境，仍可在页面修改。

### 仅体验界面

不启用 Supabase、登录和家庭成员功能：

```bash
docker compose -f docker-compose.app.yml up --build -d
```

打开 [http://localhost:3000](http://localhost:3000)。该方式使用本地文件存储，只适合本机或可信局域网，不要原样暴露到公网。

## AI 怎么选？

**DeepSeek** 是性价比之选，**OpenAI** 是土豪模式；不接模型，基础记录与协作也能用。

AI 负责理解、检索和建议；应用负责规则与安全；家人负责决定。当前 OpenAI 接入以语音转写为主，聊天能力仍在完善。

在 **设置 → AI** 可以选择 DeepSeek、OpenAI、通义千问、Kimi、智谱、混元、Gemini、Claude 或自定义服务。当前结构化聊天主链以 DeepSeek 为主；“测试 API”会发起真实请求，没有 Key 时会明确提示配置，不会模拟连接成功。

## 文档

[使用手册](docs/user-guide.md) · [本地 Supabase 部署](docs/self-hosted-supabase.md) · [系统架构](docs/system-architecture.md) · [能力矩阵](docs/capability-matrix.md)

---

> 欢迎提建议。等 UP 主有钱了，就开 Pro Max 给大家 Coding。

家庭资料很私人：真实数据、密钥、数据库和运行文件请勿提交。
