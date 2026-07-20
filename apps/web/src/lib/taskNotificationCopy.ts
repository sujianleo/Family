const dueNotificationTitlePrefixes = ["⏰ ", "🏁 ", "💧 ", "💊 ", "☀️ ", "🌙 ", "🍚 ", "👟 ", "📦 ", "🗓️ "] as const;

type ReminderMood = {
  icon: string;
  pattern: RegExp;
  body: string;
};

const reminderMoods: ReminderMood[] = [
  { icon: "🏁", pattern: /下班|收工/, body: "今天辛苦了，收工回家吧。" },
  { icon: "💧", pattern: /喝水|补水/, body: "补口水，顺便伸个懒腰。" },
  { icon: "💊", pattern: /吃药|服药|用药/, body: "照顾好自己，这件事别往后放。" },
  { icon: "☀️", pattern: /起床|早起/, body: "新的一天开场啦，慢慢醒一醒。" },
  { icon: "🌙", pattern: /睡觉|休息|晚安/, body: "今天先到这里，好好休息吧。" },
  { icon: "🍚", pattern: /吃饭|早餐|午饭|晚饭|用餐/, body: "先照顾好肚子，再忙也来得及。" },
  { icon: "👟", pattern: /运动|跑步|健身|散步/, body: "动一动，给今天加点活力。" },
  { icon: "📦", pattern: /快递|取件|包裹/, body: "小包裹在等你带它回家。" },
  { icon: "🗓️", pattern: /开会|会议|碰头/, body: "要开场了，带上重点出发吧。" }
];

const generalDueBodies = [
  "饭米粒轻轻敲了敲你：一起把这件小事接住吧。",
  "到点啦，做一点也能让家里的安排更轻松。",
  "如果现在方便，就给家里的计划搭把手吧。"
] as const;

export function buildTaskReminderNotificationCopy(taskTitle: string, offsetMinutes = 0) {
  const title = normalizeTaskTitle(taskTitle);
  if (offsetMinutes > 0) {
    return {
      title: `⏳ ${title}`,
      body: `还有 ${offsetMinutes} 分钟，不着急，先给它留个位置。`
    };
  }

  const mood = reminderMoods.find((item) => item.pattern.test(title));
  return {
    title: `${mood?.icon || "⏰"} ${title}`,
    body: mood?.body || generalDueBodies[stableIndex(title, generalDueBodies.length)]
  };
}

export function taskTitleFromDueNotification(title: string, body: string) {
  if (title.startsWith("⏳ ")) return title.slice("⏳ ".length).trim() || body || title;
  const prefix = dueNotificationTitlePrefixes.find((item) => title.startsWith(item));
  return prefix ? title.slice(prefix.length).trim() || body || title : body || title;
}

function normalizeTaskTitle(value: string) {
  return value.replace(/\s+/g, " ").trim() || "这件事";
}

function stableIndex(value: string, length: number) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + (character.codePointAt(0) || 0)) >>> 0;
  return hash % length;
}
