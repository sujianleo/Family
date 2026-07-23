export const familyAvatarRoles = [
  { key: "young-man", label: "年轻男性" },
  { key: "young-woman", label: "年轻女性" },
  { key: "little-girl", label: "小女孩" },
  { key: "little-boy", label: "小男孩" },
  { key: "grandpa", label: "爷爷" },
  { key: "grandma", label: "奶奶" },
  { key: "middle-aged-man", label: "中年男性" },
  { key: "middle-aged-woman", label: "中年女性" },
  { key: "young-father", label: "年轻父亲" },
  { key: "young-mother", label: "年轻母亲" },
  { key: "baby", label: "婴儿" },
  { key: "youth-man", label: "青年男性" },
  { key: "tied-hair-woman", label: "扎发女性" },
  { key: "long-haired-woman", label: "长发女性" },
  { key: "teen-boy", label: "青少年男孩" },
  { key: "glasses-woman", label: "戴眼镜女性" }
] as const;

const avatarAliases = new Map<string, string>([
  ["me", "young-man"], ["current-member", "young-man"], ["小明", "young-man"],
  ["wife", "young-woman"], ["daughter", "little-girl"], ["son", "little-boy"],
  ["grandpa", "grandpa"], ["grandma", "grandma"], ["uncle", "middle-aged-man"],
  ["aunt", "middle-aged-woman"], ["dad", "young-father"], ["mom", "young-mother"],
  ["baby", "baby"], ["brother", "youth-man"], ["friend", "youth-man"],
  ["guest-friend", "youth-man"], ["neighbor", "youth-man"], ["sister", "tied-hair-woman"],
  ["guest-cousin", "long-haired-woman"], ["cousin", "teen-boy"], ["classmate", "teen-boy"],
  ["fanmili", "baby"], ["backfill", "glasses-woman"], ["family", "young-woman"]
]);

const roleIndexByKey = new Map<string, number>(familyAvatarRoles.map((role, index) => [role.key, index]));

export function resolveAvatarRole(seed: string) {
  const normalizedSeed = seed.trim().toLowerCase();
  const aliasedKey = avatarAliases.get(normalizedSeed) || normalizedSeed;
  const knownIndex = roleIndexByKey.get(aliasedKey);
  if (knownIndex !== undefined) return familyAvatarRoles[knownIndex];
  return familyAvatarRoles[stableHash(normalizedSeed || "family") % familyAvatarRoles.length];
}

export function avatarSlotForSeed(seed: string) {
  return roleIndexByKey.get(resolveAvatarRole(seed).key) || 0;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
