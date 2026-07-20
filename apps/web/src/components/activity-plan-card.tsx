type ActivityPlan = {
  date: string;
  food: string;
  location: string;
  requests: string[];
  time: string;
  title: string;
  topic: string;
};

export function ActivityPlanCard({ body }: { body: string }) {
  const plan = parseActivityPlan(body);
  if (!plan) return <p>{body}</p>;
  const pendingCount = [plan.time, plan.location].filter((value) => value.includes("待大家确认")).length;
  return (
    <article className="activity-plan-card" aria-label={`${plan.title}活动计划`}>
      <header className="activity-plan-card-head">
        <span>
          <strong>{plan.title}</strong>
        </span>
        {pendingCount ? <em>{pendingCount} 项待定</em> : <em className="ready">信息已齐</em>}
      </header>
      <dl className="activity-plan-facts">
        <ActivityPlanFact icon="calendar" label="日期" value={plan.date} />
        <ActivityPlanFact icon="clock" label="时间" pending={plan.time.includes("待大家确认")} value={plan.time} />
        <ActivityPlanFact icon="pin" label="地点" pending={plan.location.includes("待大家确认")} value={plan.location} />
      </dl>
      <section className="activity-plan-summary">
        <span>聚会内容</span>
        <strong>{plan.topic}</strong>
        <p>{plan.food}</p>
      </section>
      <footer className="activity-plan-replies">
        <strong>请大家回复</strong>
        <div>{plan.requests.map((request, index) => <span key={`${request}-${index}`}>{request}</span>)}</div>
      </footer>
    </article>
  );
}

export function isActivityPlanBody(body: string) {
  return Boolean(parseActivityPlan(body));
}

export function parseActivityPlan(body: string): ActivityPlan | null {
  if (!/(?:Party|派对|聚会).*(?:安排|计划)/i.test(body) || !body.includes("请大家回复")) return null;
  const lines = body.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const readField = (label: string) => lines.find((line) => line.includes(`${label}：`))?.split(`${label}：`).slice(1).join(`${label}：`).trim() || "待大家确认";
  const title = lines[0]?.replace(/\s*(?:一起安排一下|活动安排|计划).*$/i, "").trim() || "家庭活动";
  const replyStart = lines.findIndex((line) => line === "请大家回复：" || line === "请大家回复");
  const requests = lines
    .slice(replyStart >= 0 ? replyStart + 1 : lines.length)
    .filter((line) => /^\d+[.、]/.test(line))
    .map((line) => line.replace(/^\d+[.、]\s*/, "").trim())
    .slice(0, 3);
  return {
    date: readField("日期"),
    food: readField("餐食与饮料"),
    location: readField("地点"),
    requests: requests.length ? requests : ["是否参加", "方便的时间段", "想吃什么或可以负责什么"],
    time: readField("时间"),
    title,
    topic: readField("主题")
  };
}

function ActivityPlanFact({ icon, label, pending, value }: { icon: "calendar" | "clock" | "pin"; label: string; pending?: boolean; value: string }) {
  return (
    <div>
      <i aria-hidden="true">{icon === "calendar" ? <svg viewBox="0 0 20 20"><path d="M5.5 2.5v3M14.5 2.5v3M3 7h14M4.5 4h11A1.5 1.5 0 0 1 17 5.5v10a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-10A1.5 1.5 0 0 1 4.5 4Z" /></svg> : icon === "clock" ? <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.8 1.8" /></svg> : <svg viewBox="0 0 20 20"><path d="M15.5 8.3c0 4.2-5.5 8.7-5.5 8.7S4.5 12.5 4.5 8.3a5.5 5.5 0 1 1 11 0Z" /><circle cx="10" cy="8.2" r="1.8" /></svg>}</i>
      <dt>{label}</dt>
      <dd className={pending ? "pending" : ""}>{value}</dd>
    </div>
  );
}
