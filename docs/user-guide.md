# Family User Guide

> Slogan: **Record with care. Protect your family.**

Family is not a WeChat replacement and it is not a chatbot that only makes conversation. It is first and foremost a family record and coordination tool: tasks, group chats, resources, and reminders each have a proper home. AI works on top of those reliable records to help understand, organize, summarize, and suggest.

This guide follows the natural path from first launch to everyday capture, AI features, family administration, and deployment maintenance. Read the stated limits before using anything marked experimental or configuration-dependent.

## 1. Choose how you want to run Family

### 1.1 Local demo

Use the interface and basic record features without setting up a full family service:

```bash
docker compose -f docker-compose.app.yml up --build -d
```

Open [http://localhost:3000](http://localhost:3000). This Compose profile uses local-file storage and disables mandatory sign-in. Use it only on the host machine or a trusted local network.

### 1.2 Full household deployment

A local Supabase deployment on a NAS can initialize secrets, the database, and the application through one command:

```bash
./start.sh
```

The entry point runs the internal Supabase setup automatically; do not run `scripts/setup-local-supabase.sh` separately. Family and Supabase join the same Compose project, so later you can manage them with `docker compose ps`, `docker compose stop`, and `docker compose up -d`.

Devices on the same network can open the address printed in the terminal. The first user creates the family administrator. See [Self-hosted Supabase](self-hosted-supabase.md) for the complete procedure.

Public access requires at least:

- a final HTTPS domain;
- sign-in and family-membership checks;
- fresh session, invitation, guest, and confirmation-signing secrets;
- a persistent `data/` directory or Supabase deployment;
- optional model, transcription, and Web Push configuration;
- a tested backup and restore path.

Never expose the no-auth demo configuration directly to the internet.

## 2. First launch

### 2.1 Demo mode

A new browser starts with a minimal setup flow. Choose the monochrome or dopamine theme, confirm access addresses, and optionally connect an AI provider. Demo data is for evaluation only; do not mix it with real family information.

### 2.2 Authenticated deployment

In a full deployment, an administrator creates or invites family members:

1. The administrator creates an invitation.
2. The recipient opens the link and enters the four-digit code supplied by the inviter.
3. The recipient registers or signs in with a personal account.
4. A membership request is sent to the family administrator.
5. The account is linked to the family only after administrator approval.

An invitation link locates an invitation; it is not a login credential. Knowing the link never grants family permissions automatically.

![Family invitation and collaboration flow](assets/family-collaboration-mobile.png)

[Mermaid source](family-collaboration-mobile.mmd)

### 2.3 Install the PWA

Once installed, Family opens from the home screen like a normal app.

- **iPhone / iPad:** Use Safari's **Share → Add to Home Screen**.
- **Android:** Use Chrome's **Menu → Install app** or **Add to Home screen**.
- **Desktop:** Use the install action in the address bar or browser menu.
- The install option appears only when browser, HTTPS, and operating-system requirements are met.
- Installation is optional and can be skipped.

## 3. Understand the home page

The home page has four core areas:

| Area | What belongs here | What does not belong here |
| --- | --- | --- |
| Tasks | Todos, assignments, times, reminders, and completion state | Temporary Q&A, weather, and casual chat |
| Groups | Family discussion, attachments, polls, and temporary guests | A public entrance to private whole-family data |
| Resources | Images, video, documents, voice, and long-lived information | Unconfirmed one-off speculation |
| Composer | Quick capture, natural-language commands, and AI questions | An endless chat history that replaces every real page |

The composer is a shared entry point, not the entire product. Temporary AI replies stay near the composer. Real tasks, resources, and group messages go to their dedicated areas.

## 4. Start by speaking naturally

Try examples like these:

| Input | Expected behavior |
| --- | --- |
| `Remind me to buy medicine tomorrow at 9` | Recognizes the time and creates a task candidate for confirmation |
| `Assign Saturday cleaning to Mom` | Parses the member and work, then creates an assignment candidate |
| `Who can clean the windows this weekend?` | Creates an open-volunteer task candidate |
| `Create a weekend dinner group` | Identifies or asks for members, then creates a group chat |
| `Dad had a follow-up today; the doctor wants another visit in a month` | Saves the original record and suggests a confirmable follow-up |
| `What happened at home yesterday?` | Searches saved family records and returns a concise answer |
| `Give me a family summary for this week` | Runs the weekly summary capability when data and model configuration are available |

When the system is unsure, it asks a question or presents a candidate card. It should not silently turn every sentence into a task.

## 5. Family tasks

### 5.1 Create a task

Enter the task directly and optionally include:

- a time such as `tomorrow at 9` or `Saturday morning`;
- a member such as `for Dad` or `assign to Mom`;
- a task type: personal todo, direct assignment, open volunteer, multiple choice, or text response;
- a due time and any supported advance reminder.

AI parses the request and creates a candidate. The task is written only after confirmation.

### 5.2 Review and complete

- Open a task to see members, time, source, and related discussion.
- Use the task controls to update completion state.
- Due tasks enter the reminder flow.
- Deletion, archiving, and bulk operations are high-impact actions and require explicit confirmation.

### 5.3 Create tasks from family decisions

After a poll or family judgment closes, the family can adopt the result and create a task. If there is no unique majority, the organizer must choose the final option first.

## 6. Family group chats

### 6.1 Create a group

Mention family members in the home composer or ask Family to create a group chat. Groups support text, attachments, local emoji, and member discussion.

Group chat is not intended to replace WeChat. Its purpose is to connect discussion outcomes to tasks, resources, polls, and the family timeline.

### 6.2 Save chat content as a resource

Addresses, itineraries, files, and durable information from a chat can be organized into the resource library. Long-lived content requires confirmation before storage, so a joke does not become a permanent family fact.

### 6.3 Polls and family decisions

To create a family decision in a group:

1. Enter the question and options.
2. Invite members to participate.
3. Collect choices and discussion.
4. Close the decision and review the result or AI summary.
5. Convert the adopted option into a task when useful.

## 7. Family resources

### 7.1 Upload and review

Use the attachment control beside the composer to select an image, video, document, or voice recording. Uploaded items appear in Resources, where family members can preview, open, and organize them.

Large uploads, thumbnails, document previews, and transcription depend on the deployment and its supporting services. If an upload fails, check the network, file size, format, and permissions on the persistent storage directory.

### 7.2 Health reports

A safe health-document workflow is:

1. Upload the original PDF, image, or document.
2. Keep the original file; never replace it with an AI summary.
3. Run resource parsing to extract measurements, original conclusions, and follow-up clues.
4. Prefer traceable sources when family members ask questions.
5. Create a health follow-up task candidate when another examination is needed.
6. Add the reminder or task only after family confirmation.

Health information is sensitive. Parsing is not a medical diagnosis. Model speculation must never be stored as fact or enter long-term memory without confirmation.

## 8. AI features

### 8.1 Configure a provider

Open **Settings → AI** to add a provider and select fast and deep models. Server-side environment variables are also supported:

- `DEEPSEEK_*`: a cost-conscious choice for everyday household use;
- `OPENAI_*`: currently used explicitly for OpenAI transcription, while chat-provider integration continues to evolve;
- no model configuration: tasks, groups, resources, relationships, and basic reminders still work.

**Test API** sends a real request and reports the result. If a DeepSeek card has no key, the server tries `DEEPSEEK_API_KEY`. If neither is configured, the interface asks the user to connect an API before using AI features.

The structured chat path currently centers on DeepSeek. A provider appearing in Settings does not guarantee that every chat backend is fully wired. Never place an API key in the README, screenshots, issues, or public frontend variables.

### 8.2 What AI can do

- identify intent, members, time, and subject;
- extract structured information from documents and chats;
- propose tasks, reminders, and resources;
- produce personal or family daily, weekly, and monthly summaries;
- draft member profiles;
- propose long-term memories from trusted records;
- provide concise suggestions and discussion summaries.

### 8.3 What AI cannot do

- choose arbitrary tools and execute an autonomous loop;
- bypass family permissions;
- edit the database or delete data directly;
- confirm tasks, invitations, or long-term memories on behalf of people;
- present model speculation as an original fact;
- replace a doctor or make a diagnosis.

## 9. Summaries, profiles, and long-term memory

### 9.1 Family summaries

Request a daily, weekly, or monthly summary at any time. With the correct configuration, background scheduling can generate periodic summaries as well.

Summaries are derived content. They can be regenerated and must never overwrite original chats, tasks, files, or events.

### 9.2 Member profiles

Profiles are derived from traceable records and are best suited to durable preferences, stable habits, and recurring care needs. A profile should preserve sources, confidence, and update time. Uncertain information remains a candidate rather than a definitive claim.

### 9.3 Long-term memory

Good memory candidates include stable preferences, long-term habits, family rules, and recurring patterns.

Poor candidates include one-time emotions, a temporary dinner plan, unverified health speculation, and the model's own guesses.

Long-term memory requires confirmation and can be corrected or expanded by family members.

## 10. Notifications and reminders

### 10.1 Enable notifications

Enable system notifications in profile or notification settings and grant browser permission. The full `./start.sh` deployment generates VAPID keys and starts the Supabase-backed dispatcher automatically. Public Web Push still requires HTTPS and a valid device subscription.

### 10.2 Common limitations

- iOS usually requires the PWA to be installed on the home screen.
- If browser permission was denied, re-enable it in system or site settings.
- An in-page reminder does not prove that background Web Push works.
- Production acceptance should include a real server-to-device push test.

## 11. Family members and guests

### 11.1 Family members

Family members register their own accounts and require administrator approval. Only approved identities can access authorized family tasks, resources, and records.

### 11.2 Temporary group-chat guests

Guests enter a specific group through an invitation link and four-digit code. They can see only that group and its files—not family resources, member profiles, history, or AI memory.

Temporary guest identity is normally retained on the current device for a limited time. A signed-in account is required for durable cross-device identity.

## 12. Settings

### Appearance

Choose a color theme and light, dark, or automatic display. Appearance never changes family data.

### Network

The public domain may remain empty. Setup derives a local address and users can change it later. Automatic mode checks available routes and chooses the lower-latency option; a route can also be pinned manually.

### AI

Manage providers, model IDs, assistant name, personality, and initial memory. Provider options include general APIs, coding plans, and custom services. The structured chat path currently centers on DeepSeek; rely on the integration boundary stated in the interface for every other provider.

### Members and account

Administrators manage family membership. Individual users can update their avatar, name, and password when the required authentication service is enabled.

## 13. Data, backup, and migration

### Local-file mode

Docker persists `/app/data` in a volume by default. Back up the complete volume, not only the application image.

### Supabase mode

Backups must cover the database, Storage, authentication accounts, RLS policies, and server secrets. Preserve both structured data and uploaded originals.

### Basic rules

- Never commit `.env.local`, `data/`, database backups, or user uploads.
- Back up before changing domains or devices.
- After a restore, verify sign-in, membership, attachments, tasks, and notifications.
- Export, restore, and cross-deployment migration tools are still evolving.

## 14. Troubleshooting

### A sentence did not create a task

Look for a candidate card or clarification question. Important writes require confirmation; ambiguous text does not go directly into the task list.

### AI did not answer or returned only a basic result

Check the provider key, model ID, network, and provider configuration. Without a model, deterministic features remain available, but model-generated summaries do not appear magically.

### An uploaded file has no parsing result

Confirm that the file was stored, then check format, size, parsing services, and model configuration. Scanned PDFs may also require OCR.

### System notifications do not arrive

Check HTTPS, PWA installation, browser permission, VAPID, the subscription endpoint, and background dispatch in that order. In-page reminders do not prove that Web Push is connected.

### An invitation link does not open or membership fails

Check the public URL, HTTPS, invitation secret, expiry, and four-digit code. Family invitations also require account registration and administrator approval.

### Can real family data be posted in a public issue?

No. Redact it first. Secrets, medical reports, relationships, phone numbers, addresses, chat history, and exploitable vulnerabilities must not be posted publicly.

## 15. One-minute checklist

- [ ] Start Family locally and open the home page.
- [ ] Capture an ordinary household record.
- [ ] Create a task that requires confirmation.
- [ ] Create a family group and send an attachment.
- [ ] Upload a redacted document and review Resources.
- [ ] Decide whether to connect DeepSeek or OpenAI.
- [ ] Test a summary or document parse.
- [ ] Enable authentication, HTTPS, fresh secrets, and backups before public deployment.
- [ ] Verify PWA installation and notifications on a real device.

Return to the [project README](../README.md), or continue with [System Architecture](system-architecture.md).
