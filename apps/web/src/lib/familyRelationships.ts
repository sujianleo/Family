export const familyRelationshipOptions = [
  "老公", "老婆", "爸爸", "妈妈",
  "儿子", "大儿子", "二儿子", "小儿子",
  "女儿", "大女儿", "二女儿", "小女儿",
  "哥哥", "弟弟", "姐姐", "妹妹",
  "爷爷", "奶奶", "姥爷", "姥姥",
  "孙子", "孙女", "外孙", "外孙女",
  "儿媳", "女婿", "姑姑", "舅舅", "姨妈", "叔叔",
  "其他亲属"
] as const;

const relationshipAliases: Record<string, string> = {
  丈夫: "老公",
  先生: "老公",
  妻子: "老婆",
  媳妇: "老婆",
  太太: "老婆",
  父亲: "爸爸",
  母亲: "妈妈",
  闺女: "女儿",
  外公: "姥爷",
  外婆: "姥姥"
};

export function normalizeFamilyRelationshipLabel(label: string, displayName = "") {
  const value = label.trim();
  if (!value) return "";
  if (value === "配偶") {
    if (/(老婆|妻子|媳妇|太太)/.test(displayName)) return "老婆";
    if (/(老公|丈夫|先生)/.test(displayName)) return "老公";
  }
  return relationshipAliases[value] || value;
}

export function relationshipKindForLabel(label: string) {
  const value = normalizeFamilyRelationshipLabel(label);
  if (["老公", "老婆", "配偶"].includes(value)) return "spouse";
  if (["爸爸", "妈妈", "爷爷", "奶奶", "姥爷", "姥姥"].includes(value)) return "parent";
  if (["儿子", "大儿子", "二儿子", "小儿子", "女儿", "大女儿", "二女儿", "小女儿", "孙子", "孙女", "外孙", "外孙女", "儿媳", "女婿"].includes(value)) return "child";
  if (["哥哥", "弟弟", "姐姐", "妹妹"].includes(value)) return "sibling";
  return "relative";
}
