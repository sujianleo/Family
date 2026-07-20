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

```text
01  随手记录
    任务 · 语音 · 文件
          │
          ▼
02  家庭时间线
    什么时候 · 谁 · 什么事
          │
          ▼
03  AI 整理
    检索 · 总结 · 找证据
          │
          ▼
04  家人确认
    重要决定不交给模型
          │
          ▼
05  提醒与跟进
    今天做完，明天还记得
          │
          └──── ↺ 继续记录
```

## Quick Start

```bash
docker compose up --build -d
```

打开 [http://localhost:3000](http://localhost:3000)。正式邀请家人前，请先配置认证、Secret、HTTPS 和备份。

## AI 怎么选？

**DeepSeek** 是性价比之选，**OpenAI** 是土豪模式；不接模型，基础记录与协作也能用。

AI 负责理解、检索和建议；应用负责规则与安全；家人负责决定。当前 OpenAI 接入以语音转写为主，聊天能力仍在完善。

## 文档

[使用手册](docs/user-guide.md) · [系统架构](docs/system-architecture.md) · [能力矩阵](docs/capability-matrix.md)

---

> 欢迎提建议。等 UP 主有钱了，就开 Pro Max 给大家 Coding。

家庭资料很私人：真实数据、密钥、数据库和运行文件请勿提交。
