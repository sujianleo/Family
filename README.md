<h3 align="center">
  <img src="apps/web/public/family-logo-v2.png" alt="Family" width="120" />
</h3>

<p align="center">
  <img alt="Self-hosted" src="https://img.shields.io/badge/SELF--HOSTED-2F6F68?style=flat-square" />
  <img alt="AI optional" src="https://img.shields.io/badge/AI-OPTIONAL-1E514C?style=flat-square" />
  <img alt="PWA" src="https://img.shields.io/badge/PWA-6C717C?style=flat-square" />
  <br />
  <img alt="Next.js" src="https://img.shields.io/badge/NEXT.JS-20302A?style=flat-square&logo=nextdotjs&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TYPESCRIPT-2F6F68?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Supabase" src="https://img.shields.io/badge/SUPABASE-4A8F7B?style=flat-square&logo=supabase&logoColor=white" />
  <img alt="LangChain" src="https://img.shields.io/badge/LANGCHAIN-9584C5?style=flat-square&logo=langchain&logoColor=white" />
</p>

---

<h1 align="center">我爱饭米粒</h1>

**用心记录，守护家庭。** Record with care, protect your family, and keep household tasks, health documents, and family coordination safely organized over time.

A family rarely needs another group chat. It needs a place that remembers what matters, helps someone take responsibility, and follows through.

---

## What can it do for your family?

- **Health records:** Keep reports and follow-up plans together, ready when you need them.
- **Family coordination:** Assign tasks and reminders without digging through endless chat history.
- **Long-term memory:** Capture something today and still find it tomorrow—or years from now.
- **People stay in charge:** AI can organize and suggest; the family always makes the decision.

## How does a household task get handled properly?

1. **Capture it:** Add a task, voice note, or file whenever it comes to mind.

2. **Put it in order:** Time, people, and context fall naturally into the family timeline.

3. **Find what matters:** AI retrieves, summarizes, and highlights without making decisions for you.

4. **Confirm first:** Important actions are shown to the family before anything happens.

5. **Follow through:** Reminders, tasks, and feedback remain part of the record after the work is done.

## Quick Start

### Docker Compose: full household deployment

Install Docker Compose 2.20+, Git, and OpenSSL. From the project directory, run this once:

```bash
./start.sh
```

This single command handles the setup:

- **Find the address:** Detect the NAS IP and create a local-network URL.
- **Prepare secrets:** Generate independent secrets and write the connection settings.
- **Install services:** Download the required components and prepare data and file storage.
- **Start Family:** Build the app, launch the containers, and create the database tables.

> On the first run, do not jump straight to `docker compose up`. `./start.sh` generates the Supabase configuration before handing control to Compose.

Family, PostgreSQL, Auth, API, and Storage run in one Compose project. Each has a separate job, but they start and stop together.

After the first setup, these three commands cover everyday operation:

```bash
docker compose up -d
docker compose ps
docker compose stop
```

Open the URL printed in the terminal and create the first family administrator. Invite relatives afterward; once the administrator approves them, the family can share tasks, group chats, feedback, and documents.

If the NAS has multiple network interfaces, specify the address explicitly:

```bash
FAMILY_APP_HOST=192.168.1.20 ./start.sh
```

Networking is designed to stay out of the way:

- **Local access:** Open the link from any device on the same network.
- **Internet access:** Leave the public address empty and add HTTPS later when needed.
- **Automatic selection:** Detect available routes and choose the faster one.
- **Manual control:** Accept the detected default or change it in the app at any time.

See [Self-hosted Supabase](docs/self-hosted-supabase.md) for complete configuration and backup instructions.

### Just want to take a look?

Launch the interface-only demo without Supabase, sign-in, or family membership:

```bash
docker compose -f docker-compose.app.yml up --build -d
```

Open [http://localhost:3000](http://localhost:3000). Data is written only to local files. This mode is great for a quick tour, but it should not be exposed directly to the internet.

## Which AI should you use?

- **DeepSeek:** Budget-friendly and well suited to everyday organization and questions.
- **OpenAI:** A broad capability set, currently used mainly for speech transcription.
- **No AI for now:** Records, tasks, invitations, and synchronization still work normally.

AI handles understanding and suggestions. Family handles rules and safety. The final decision always belongs to the people involved.

Open **Settings → AI** to choose DeepSeek, OpenAI, Qwen, Kimi, Zhipu, Hunyuan, Gemini, Claude, or a custom provider. **Test API** sends a real request—no pretend green lights.

## Documentation

[User Guide](docs/user-guide.md) · [Self-hosted Supabase](docs/self-hosted-supabase.md) · [System Architecture](docs/system-architecture.md) · [Capability Matrix](docs/capability-matrix.md)

---

> Feedback is always welcome. Family is still young; let us raise it together.

Family data is deeply private. Never commit real records, secrets, databases, or runtime files.
