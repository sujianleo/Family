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

**用心记录，守护家庭。** 把家事、健康资料和家庭协作，安稳地放回时间里。

家里不缺一个新群，缺的是有人把事情记住、接住，再一路跟到底。

---

## 它能帮家里做什么？

- **健康资料**：收好报告和复查安排，需要时一眼找到。
- **家庭协作**：分清任务和提醒事项，少在群里来回翻找。
- **长期记录**：今天顺手记下一笔，明天照样找得到。
- **家人做主**：AI 帮忙整理和建议，决定始终归家人。

## 一件家事，怎样被好好接住？

1. **记下来**：任务、语音、文件，都可以顺手放进来。

2. **排清楚**：时间、人物、事项，自动回到时间线上。

3. **找重点**：AI 检索、归纳、提示，但不会替你决定。

4. **再确认**：重要动作先给家人看，点头以后才执行。

5. **跟到底**：提醒、任务、反馈，做完以后仍有记录。

## Quick Start

### Docker Compose（完整家庭部署）

准备好 Docker Compose 2.20+、Git 和 OpenSSL。进入项目目录，第一次只运行：

```bash
./start.sh
```

这一个入口会把准备工作全部做完：

- **找地址**：识别 NAS IP，生成局域网访问链接。
- **配密钥**：生成独立密钥，连接参数也会自动写好。
- **装服务**：下载服务组件，准备数据和文件存储。
- **开饭米粒**：构建应用、启动容器，再创建数据表。

> 第一次别急着运行 `docker compose up`。`./start.sh` 会先生成 Supabase 配置，再交给 Compose 启动。

饭米粒、PostgreSQL、Auth、API 和 Storage 会进入同一个 Compose 项目。它们各自分工，但可以一起启动、一起停止。

第一次完成后，日常只需要这三条：

```bash
docker compose up -d
docker compose ps
docker compose stop
```

打开终端给出的地址，创建第一位家庭管理员。之后邀请家人，管理员确认后即可共享任务、群聊、反馈和资料。

NAS 有多个网卡时，可以直接指定地址：

```bash
FAMILY_APP_HOST=192.168.1.20 ./start.sh
```

连接方式也尽量省心：

- **局域网访问**：同一网络内，打开链接立刻就能用。
- **公网访问**：地址可以留空，需要时再配 HTTPS。
- **自动切换**：检测可用线路，自动选择更快一条。
- **手动修改**：默认地址自动获取，页面里随时能改。

完整配置与备份方法见[本地 Supabase 部署](docs/self-hosted-supabase.md)。

### 只想先看看

不启用 Supabase、登录和家庭成员，直接启动界面体验版：

```bash
docker compose -f docker-compose.app.yml up --build -d
```

打开 [http://localhost:3000](http://localhost:3000)。数据只写本地文件，适合体验，不适合直接放到公网。

## AI 怎么选？

- **DeepSeek**：价格友好，适合日常整理和问答。
- **OpenAI**：能力全面，目前主要用于语音转写。
- **暂时不接**：记录、任务、邀请和同步全部照常能用。

AI 负责理解和建议，饭米粒负责规则与安全，最后决定始终留给家人。

进入 **设置 → AI**，可选择 DeepSeek、OpenAI、通义千问、Kimi、智谱、混元、Gemini、Claude 或自定义服务。“测试 API”会发起真实请求，不会假装连接成功。

## 文档

[使用手册](docs/user-guide.md) · [本地 Supabase 部署](docs/self-hosted-supabase.md) · [系统架构](docs/system-architecture.md) · [能力矩阵](docs/capability-matrix.md)

---

> 欢迎提建议。饭米粒还小，我们慢慢把它养大。

家庭资料很私人：真实数据、密钥、数据库和运行文件请勿提交。
