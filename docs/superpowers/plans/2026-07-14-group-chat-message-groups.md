# Group Chat Message Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render consecutive group-chat messages as one avatar/name/content group and keep only active discussions in the compact top area.

**Architecture:** Add a deterministic grouping helper beside the existing sender comparison, then render one group wrapper per consecutive sender while preserving per-message interaction nodes. Filter the existing compact context list before sorting and slicing, without changing full timeline records or the chat scroll container.

**Tech Stack:** React 19, TypeScript, Next.js, CSS, Node smoke tests, Playwright browser validation.

---

### Task 1: Lock the grouped-message and active-context contracts

**Files:**
- Modify: `project/apps/web/scripts/group-chat-keyboard-smoke.ts`

- [ ] **Step 1: Add failing source-contract assertions**

```ts
assert.ok(recordListSource.includes("groupChatMessages(renderedMessages)"), "chat should render consecutive messages through explicit groups");
assert.ok(recordListSource.includes('className="chat-message-group-header"'), "each message group should have one sender header");
assert.ok(recordListSource.includes('className="chat-message-group-items"'), "all consecutive content should live under the shared header");
assert.ok(recordListSource.includes('poll.status === "open"'), "compact context should exclude completed polls");
assert.ok(recordListSource.includes('judgement.status === "active"'), "compact context should exclude completed judgements");
assert.ok(!recordListSource.includes('className="chat-pinned-compact-title"'), "compact context should not render a count title");
assert.ok(globalsSource.includes("font-size: 12px;"), "group sender names should use the compact caption size");
assert.ok(globalsSource.includes("color: rgba(0, 0, 0, 0.45);"), "group sender names should remain visually secondary");
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd project/apps/web && npm run test:group-chat-keyboard`

Expected: FAIL on the first new grouped-message assertion.

- [ ] **Step 3: Commit the failing contract**

```bash
git add project/apps/web/scripts/group-chat-keyboard-smoke.ts
git commit -m "test(web): define grouped chat message layout"
```

### Task 2: Build deterministic message groups and filter completed context

**Files:**
- Modify: `project/apps/web/src/components/record-list.tsx:210-225`
- Modify: `project/apps/web/src/components/record-list.tsx:3960-3970`
- Modify: `project/apps/web/src/components/record-list.tsx:4890-4975`

- [ ] **Step 1: Add the grouping helper**

```ts
function groupChatMessages(messages: RoomMessage[]) {
  return messages.reduce<RoomMessage[][]>((groups, message) => {
    const currentGroup = groups.at(-1);
    if (currentGroup && hasSameChatSender(currentGroup[0], message)) {
      currentGroup.push(message);
    } else {
      groups.push([message]);
    }
    return groups;
  }, []);
}
```

- [ ] **Step 2: Filter the compact context list before sorting**

```ts
const collapsedContextItems = useMemo(() => [
  ...polls.filter((poll) => poll.status === "open").map((poll) => ({ createdAt: poll.createdAt, id: poll.id, kind: "poll" as const, poll })),
  ...judgements.filter((judgement) => judgement.status === "active" && (!judgement.endsAt || new Date(judgement.endsAt) > new Date())).map((judgement) => ({ createdAt: judgement.createdAt, id: judgement.id, judgement, kind: "judgement" as const }))
].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 3), [judgements, polls]);
```

- [ ] **Step 3: Replace per-message outer rows with group wrappers**

Render `groupChatMessages(renderedMessages).map((messageGroup) => ...)`. The wrapper contains one `.chat-message-group-header` with `MemberAvatar` and sender name, followed by `.chat-message-group-items`. Keep each original message inside its own `.chat-message` node so `data-judgement-id`, long press, selection, deletion, attachment preview, and action menus retain their existing handlers.

- [ ] **Step 4: Remove the compact count title**

Delete the conditional `.chat-pinned-compact-title` node. Leave active compact rows, title, participant count, and arrow unchanged.

- [ ] **Step 5: Run the focused test**

Run: `cd project/apps/web && npm run test:group-chat-keyboard`

Expected: `group chat keyboard smoke passed`.

- [ ] **Step 6: Commit the functional change**

```bash
git add project/apps/web/src/components/record-list.tsx
git commit -m "fix(web): group consecutive chat messages"
```

### Task 3: Align the group header and content with minimal styling

**Files:**
- Modify: `project/apps/web/src/app/globals.css:3545-3670`

- [ ] **Step 1: Replace row-level avatar positioning with group layout styles**

```css
.chat-message-group {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  max-width: 84%;
  align-self: flex-start;
}

.chat-message-group-body {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.chat-message-group-header {
  margin: 0 0 5px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
}

.chat-message-group-items {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
```

Retain existing message bubble, image, file, selection, and action-menu styles. Add direction-specific overrides only where needed to preserve the existing `mine` alignment contract.

- [ ] **Step 2: Remove obsolete continued-row and sender-name rules**

Delete `.chat-message.continued`, row-level avatar grid placement, and `.chat-message-content > strong` rules after the JSX no longer uses them. Do not change composer, header, member bar, or `.chat-fullscreen-messages` scrolling declarations.

- [ ] **Step 3: Run focused and type checks**

Run: `cd project/apps/web && npm run test:group-chat-keyboard && npm run typecheck`

Expected: focused smoke passes and TypeScript exits with code 0.

- [ ] **Step 4: Commit styling**

```bash
git add project/apps/web/src/app/globals.css project/apps/web/scripts/group-chat-keyboard-smoke.ts
git commit -m "style(web): align grouped chat media"
```

### Task 4: Rendered mobile QA and deployment

**Files:**
- Verify: `project/apps/web/src/components/record-list.tsx`
- Verify: `project/apps/web/src/app/globals.css`

- [ ] **Step 1: Run the release regression set**

Run: `cd project/apps/web && npm run test:release`

Expected: all release smoke scripts pass.

- [ ] **Step 2: Refresh repository maps**

Run: `cd project/apps/web && codegraph sync && repomap generate`

Expected: both indexes complete without source parse failures.

- [ ] **Step 3: Deploy the fixed production runtime**

Run: `docker compose up --build -d`

Expected: production build passes, local `127.0.0.1:3001` returns 200, and the public tunnel returns 200.

- [ ] **Step 4: Validate the mobile rendered flow**

Flow: homepage -> open “周末聚餐临时群聊” -> inspect consecutive image messages -> long-press one image -> scroll the message list.

Verify at 390x844: one avatar/name per consecutive sender group; nickname aligns with image and later text; nickname is not overlaid; completed context rows and count title are absent; long-press menu still opens; `.chat-fullscreen-messages` remains independently scrollable; no relevant console errors.

- [ ] **Step 5: Record final commit state**

Run: `git status --short && git log -4 --oneline`

Expected: task files are committed; unrelated pre-existing worktree changes remain untouched.
