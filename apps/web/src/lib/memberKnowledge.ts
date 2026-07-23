export type MemberKnowledgeEvidence = {
  actorMemberId?: string;
  actorName: string;
  confirmationStatus?: "confirmed" | "conflicted" | "self_reported" | "unconfirmed";
  createdAt: string;
  factType?: string;
  sensitivity?: "normal" | "sensitive";
  speakerMemberId?: string;
  sourceId: string;
  sourceType: string;
  subjectMemberId?: string;
  text: string;
  validFrom?: string;
  validUntil?: string | null;
};

export type MemberKnowledgeResolution =
  | {
      evidence: MemberKnowledgeEvidence[];
      evidenceIds: string[];
      kind: "evidence_answer";
      text: string;
    }
  | {
      evidence: [];
      evidenceIds: [];
      familyQuestionPlan: {
        dateLabel: null;
        memberIds: string[];
        message: string;
        question: string;
        title: string;
      };
      kind: "ask_member";
      options: Array<{
        label: string;
        value: "ask_member" | "dismiss" | "provide_input";
      }>;
      text: string;
    };

const aliasesByMemberId: Record<string, string[]> = {
  dad: ["爸爸", "老爸", "父亲", "爸"],
  daughter: ["闺女", "女儿", "姑娘"],
  mom: ["老妈", "妈妈", "母亲", "妈"],
  sister: ["姐姐", "老姐", "姐"],
  son: ["儿子", "孩子", "男孩"],
  wife: ["老婆", "媳妇", "妻子", "太太", "爱人"]
};

export function resolveMemberKnowledgeOutcome(input: {
  evidence: MemberKnowledgeEvidence[];
  memberId: string;
  memberName: string;
  now?: Date;
  question: string;
}): MemberKnowledgeResolution {
  const relevant = selectRelevantMemberEvidence(input).slice(0, 3);
  if (relevant.length && !hasEvidenceConflict(relevant)) {
    const detail = relevant.map((item) => `• ${item.text}`).join("\n");
    return {
      evidence: relevant,
      evidenceIds: relevant.map((item) => item.sourceId),
      kind: "evidence_answer",
      text: `我查到 ${relevant.length} 条可引用依据：\n${detail}`
    };
  }

  const question = input.question.replace(/[。.!！?？]+$/, "").trim();
  const title = `问问${input.memberName}`;
  return {
    evidence: [],
    evidenceIds: [],
    familyQuestionPlan: {
      dateLabel: null,
      memberIds: [input.memberId],
      message: `现有家庭记录里没有找到足够依据。${input.memberName}，想直接向你确认：${question}？\n\n请你直接回复，家庭助手会把回答作为本次对话依据；未经确认不会写入长期记忆。`,
      question: `${question}？`,
      title
    },
    kind: "ask_member",
    options: [
      { label: `问${input.memberName}`, value: "ask_member" },
      { label: "我来补充", value: "provide_input" },
      { label: "先不处理", value: "dismiss" }
    ],
    text: `现有家庭记录里没有找到关于${input.memberName}的可靠依据，已准备创建「${title}」定向群聊向本人确认。`
  };
}

function selectRelevantMemberEvidence(input: {
  evidence: MemberKnowledgeEvidence[];
  memberId: string;
  memberName: string;
  now?: Date;
  question: string;
}) {
  const aliases = new Set([input.memberName, ...(aliasesByMemberId[input.memberId] || [])]);
  const topic = inferQuestionTopic(input.question);
  if (!topic) return [];
  const now = input.now || new Date();
  return input.evidence
    .filter((item) => {
      const targetIsSpeaker = item.actorMemberId === input.memberId || [...aliases].some((alias) => item.actorName.includes(alias));
      const structuredTargetSpeaker = item.speakerMemberId === input.memberId;
      const targetIsSubject = item.subjectMemberId === input.memberId || [...aliases].some((alias) => item.text.includes(alias));
      const confirmedMemory = item.sourceType === "memory.confirmed" || item.confirmationStatus === "confirmed";
      const rejectedByConfirmation = item.confirmationStatus === "conflicted" || (item.confirmationStatus === "unconfirmed" && item.sensitivity === "sensitive");
      const thirdPartyGuess = /(?:我猜|猜测|可能|也许|大概|听说|好像|估计)/.test(item.text);
      const sensitive = ["contact", "health", "location", "medication", "schedule"].includes(topic);
      const validFrom = new Date(item.validFrom || item.createdAt).getTime();
      const validUntil = item.validUntil ? new Date(item.validUntil).getTime() : null;
      const withinDeclaredValidity = Number.isFinite(validFrom) && validFrom <= now.getTime() && (validUntil === null || validUntil >= now.getTime());
      const freshEnough = !sensitive || now.getTime() - new Date(item.createdAt).getTime() <= 180 * 86_400_000;
      const trustMatched = structuredTargetSpeaker || targetIsSpeaker || confirmedMemory || (!sensitive && targetIsSubject && !thirdPartyGuess);
      const factTypeMatched = !item.factType || item.factType === topic || item.factType === "family_fact";
      return !rejectedByConfirmation && trustMatched && withinDeclaredValidity && freshEnough && factTypeMatched && topicMatchesEvidence(topic, item.text);
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export type KnowledgeTopic = "age" | "appointment" | "availability" | "birthday" | "contact" | "food" | "gift" | "health" | "location" | "medication" | "schedule" | "size" | "support" | "travel";

export function inferQuestionTopic(question: string): KnowledgeTopic | null {
  if (/手机号|电话|联系方式/.test(question)) return "contact";
  if (/血压|血糖|体温|心率|过敏|身体|心情/.test(question)) return "health";
  if (/吃什么药|什么药|降压药|用药|服药/.test(question)) return "medication";
  if (/复查|复诊|体检|家长会|预约/.test(question)) return "appointment";
  if (/医保卡|社保卡|钥匙|证件|放哪|在哪|哪里/.test(question)) return "location";
  if (/生日|纪念日/.test(question)) return "birthday";
  if (/年龄|年纪|几岁|多大(?:了|岁|年纪|年龄)?[？?。.!！]?$/.test(question)) return "age";
  if (/鞋码|衣服|尺寸|多大码/.test(question)) return "size";
  if (/有没有空|有空|方便/.test(question)) return "availability";
  if (/几点|什么时候|哪天|周几|回来|出门/.test(question)) return "schedule";
  if (/礼物|想要什么/.test(question)) return "gift";
  if (/需要.{0,10}(?:帮|做)|帮什么/.test(question)) return "support";
  if (/旅行|高铁|开车|出游/.test(question)) return "travel";
  if (/吃什么|忌口|不吃|爱吃|喜欢吃/.test(question)) return "food";
  return null;
}

function topicMatchesEvidence(topic: KnowledgeTopic, text: string) {
  const patterns: Record<KnowledgeTopic, RegExp> = {
    age: /年龄|年纪|\d{1,3}\s*岁|出生于?/,
    appointment: /复查|复诊|体检|家长会|预约|挂号|约.{0,8}(?:月|日|号|周|星期|点)/,
    availability: /有空|没空|方便|不方便|可以|不行|周|星期/,
    birthday: /生日|纪念日|农历|公历|月.{0,4}(?:日|号)/,
    contact: /手机号|电话|联系方式|1\d{10}/,
    food: /想吃|爱吃|喜欢吃|不吃|忌口|过敏|饭|菜|鱼|肉|奶|香菜|海鲜/,
    gift: /礼物|想要|围巾|鞋|花|书|手表/,
    health: /血压|血糖|体温|心率|过敏|心情|情绪|开心|难受|\d{2,3}\s*\/\s*\d{2,3}/,
    location: /医保卡|社保卡|钥匙|证件|抽屉|柜|书房|卧室|客厅|医院|学校|放在|收在|位于/,
    medication: /药|服用|服药|一片|半片|胶囊|氨氯地平|阿司匹林|二甲双胍/,
    schedule: /今天|明天|今晚|早上|上午|中午|下午|晚上|周|星期|点|时|回来|出门/,
    size: /鞋码|尺码|尺寸|\d{2,3}\s*码|[SMLX]{1,3}\s*码?/i,
    support: /帮|陪|接送|照顾|准备|代办|复查|买|拿|送/,
    travel: /高铁|开车|飞机|火车|旅行|出游|自驾/
  };
  return patterns[topic].test(text);
}

function hasEvidenceConflict(evidence: MemberKnowledgeEvidence[]) {
  const polarities = new Set(evidence.map((item) => evidencePolarity(item.text)).filter(Boolean));
  return polarities.has("positive") && polarities.has("negative");
}

function evidencePolarity(text: string) {
  if (/不过敏|不喜欢|不吃|忌口|没空|不方便|没有|不是/.test(text)) return "negative";
  if (/过敏|喜欢|爱吃|有空|方便|有|是/.test(text)) return "positive";
  return "";
}
