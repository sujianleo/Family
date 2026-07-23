import type { FamilyMember } from "./types";
import { normalizeFamilyRelationshipLabel } from "./familyRelationships";

const localLabels: Record<string, Record<string, string>> = {
  me: { wife: "老婆", sister: "姐姐", mom: "妈妈", dad: "爸爸", daughter: "女儿", son: "儿子" },
  wife: { me: "老公", sister: "大姑姐", mom: "婆婆", dad: "公公", daughter: "女儿", son: "儿子" },
  sister: { me: "弟弟", wife: "弟媳", mom: "妈妈", dad: "爸爸", daughter: "侄女", son: "侄子" },
  mom: { me: "儿子", wife: "儿媳", sister: "女儿", dad: "配偶", daughter: "孙女", son: "孙子" },
  dad: { me: "儿子", wife: "儿媳", sister: "女儿", mom: "配偶", daughter: "孙女", son: "孙子" },
  daughter: { me: "爸爸", wife: "妈妈", sister: "姑姑", mom: "奶奶", dad: "爷爷", son: "兄弟" },
  son: { me: "爸爸", wife: "妈妈", sister: "姑姑", mom: "奶奶", dad: "爷爷", daughter: "姐妹" }
};

export function applyLocalRelationshipPerspective(members: FamilyMember[], viewerMemberId: string) {
  const labels = localLabels[viewerMemberId] || {};
  return members.map((member) => ({
    ...member,
    relationshipLabel: member.id === viewerMemberId
      ? "我"
      : normalizeFamilyRelationshipLabel(labels[member.id] || member.relationshipLabel || fallbackRoleLabel(member), member.displayName)
  }));
}

export type RelationshipEdge = { objectMemberId: string; relationshipKind: string; relationshipLabel: string; subjectMemberId: string };

export function resolveRelationshipPerspective(members: FamilyMember[], viewerMemberId: string, edges: RelationshipEdge[]) {
  const adjacency = new Map<string, RelationshipEdge[]>();
  edges.forEach((edge) => adjacency.set(edge.subjectMemberId, [...(adjacency.get(edge.subjectMemberId) || []), edge]));
  const labels = new Map<string, string>([[viewerMemberId, "我"]]);
  const queue: Array<{ kinds: string[]; memberId: string }> = [{ kinds: [], memberId: viewerMemberId }];
  const visited = new Set([viewerMemberId]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of adjacency.get(current.memberId) || []) {
      const kinds = [...current.kinds, edge.relationshipKind];
      if (!labels.has(edge.objectMemberId)) labels.set(edge.objectMemberId, kinds.length === 1 ? edge.relationshipLabel : inferKinshipLabel(kinds, members.find((member) => member.id === edge.objectMemberId)));
      if (kinds.length < 3 && !visited.has(edge.objectMemberId)) {
        visited.add(edge.objectMemberId);
        queue.push({ kinds, memberId: edge.objectMemberId });
      }
    }
  }
  return members.map((member) => ({
    ...member,
    relationshipLabel: member.id === viewerMemberId
      ? "我"
      : normalizeFamilyRelationshipLabel(labels.get(member.id) || member.relationshipLabel || fallbackRoleLabel(member), member.displayName)
  }));
}

function inferKinshipLabel(kinds: string[], target?: FamilyMember) {
  const path = kinds.join(">");
  const female = /(妈|母|婆|妻|女|姐|妹|奶奶|外婆|姑|姨)/.test(`${target?.displayName || ""} ${target?.relationshipLabel || ""}`);
  if (path === "spouse>parent") return female ? "婆婆/岳母" : "公公/岳父";
  if (path === "spouse>child") return female ? "女儿" : "儿子";
  if (path === "parent>child") return female ? "姐妹" : "兄弟姐妹";
  if (path === "parent>parent") return female ? "奶奶/外婆" : "爷爷/外公";
  if (path === "child>child") return female ? "孙女/外孙女" : "孙辈";
  if (path === "child>spouse") return female ? "儿媳/女婿配偶" : "女婿/儿媳配偶";
  if (path === "sibling>child") return female ? "侄女/外甥女" : "侄子/外甥";
  return "亲属";
}

function fallbackRoleLabel(member: FamilyMember) {
  if (member.householdRoles?.includes("assistant")) return "家庭助手";
  if (member.relationshipRole === "guest") return "访客";
  return member.displayName;
}
