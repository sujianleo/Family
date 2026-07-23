import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DEFAULT_ASSISTANT_NAME } from "../assistantIdentity";
import { familyMembers } from "../mockData";
import type { FamilyMember, MemberProfile } from "../types";
import { withCalculatedMemberAge } from "../memberProfileAge";

export type MemberOverride = {
  avatarSeed?: string;
  displayName: string;
  memberId: string;
  previousNames: string[];
  profile?: MemberProfile;
  updatedAt: string;
};

export async function readMemberOverrides(dataDir: string) {
  try {
    const content = await readFile(`${dataDir}/member-overrides.json`, "utf8");
    const data = JSON.parse(content) as { members?: MemberOverride[] };
    return Array.isArray(data.members) ? data.members : [];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function readRemovedMemberIds(dataDir: string) {
  try {
    const content = await readFile(`${dataDir}/member-overrides.json`, "utf8");
    const data = JSON.parse(content) as { removedMemberIds?: string[] };
    return Array.isArray(data.removedMemberIds) ? data.removedMemberIds.filter(Boolean) : [];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function readFamilyMembersWithOverrides(dataDir: string, now = new Date()): Promise<FamilyMember[]> {
  const [overrides, removedMemberIds] = await Promise.all([readMemberOverrides(dataDir), readRemovedMemberIds(dataDir)]);
  const removed = new Set(removedMemberIds);
  return familyMembers.filter((member) => !removed.has(member.id)).map((member) => {
    const override = overrides.find((item) => item.memberId === member.id);
    return override
      ? {
          ...member,
          avatarSeed: override.avatarSeed || member.avatarSeed,
          displayName: override.displayName,
          profile: withCalculatedMemberAge({ ...(member.profile || {}), ...(override.profile || {}) }, now)
        }
      : { ...member, profile: withCalculatedMemberAge(member.profile, now) };
  });
}

export async function removeFamilyMember(dataDir: string, memberId: string) {
  const content = await readFile(`${dataDir}/member-overrides.json`, "utf8").catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "{}";
    throw error;
  });
  const data = JSON.parse(content) as { members?: MemberOverride[]; removedMemberIds?: string[] };
  const removedMemberIds = [...new Set([...(data.removedMemberIds || []), memberId])];
  await mkdir(dataDir, { recursive: true });
  await writeFile(`${dataDir}/member-overrides.json`, `${JSON.stringify({ members: data.members || [], removedMemberIds }, null, 2)}\n`, "utf8");
  return { memberId };
}

export async function renameFamilyMember(dataDir: string, memberQuery: string, newName: string, now = new Date()) {
  const trimmedName = newName.trim();
  if (!trimmedName) {
    throw new Error("缺少新的成员名称。");
  }

  const overrides = await readMemberOverrides(dataDir);
  const members = await readFamilyMembersWithOverrides(dataDir);
  const member = resolveMember(members, overrides, memberQuery);
  if (!member) {
    throw new Error(`没有找到成员: ${memberQuery}`);
  }

  const existingOverride = overrides.find((item) => item.memberId === member.id);
  const previousNames = new Set([...(existingOverride?.previousNames || []), member.displayName]);
  const nextOverrides = [
    ...overrides.filter((item) => item.memberId !== member.id),
    {
      avatarSeed: existingOverride?.avatarSeed,
      displayName: trimmedName,
      memberId: member.id,
      previousNames: [...previousNames].filter((name) => name !== trimmedName),
      profile: existingOverride?.profile,
      updatedAt: now.toISOString()
    }
  ];

  await mkdir(dataDir, { recursive: true });
  const removedMemberIds = await readRemovedMemberIds(dataDir);
  await writeFile(`${dataDir}/member-overrides.json`, `${JSON.stringify({ members: nextOverrides, removedMemberIds }, null, 2)}\n`, "utf8");

  return {
    memberId: member.id,
    newName: trimmedName,
    previousName: member.displayName
  };
}

export async function updateFamilyMemberProfile(
  dataDir: string,
  memberId: string,
  patch: { avatarSeed?: string; displayName?: string; profile?: Partial<MemberProfile> },
  now = new Date()
) {
  const overrides = await readMemberOverrides(dataDir);
  const member = familyMembers.find((candidate) => candidate.id === memberId);
  if (!member) throw new Error("没有找到当前家庭成员。");
  const existingOverride = overrides.find((item) => item.memberId === memberId);
  const displayName = patch.displayName?.trim().slice(0, 16) || existingOverride?.displayName || member.displayName;
  const avatarSeed = patch.avatarSeed?.trim() || existingOverride?.avatarSeed || member.avatarSeed;
  const profile = patch.profile
    ? {
        ...(member.profile || {}),
        ...(existingOverride?.profile || {}),
        ...Object.fromEntries(Object.entries(patch.profile).filter(([, value]) => value !== undefined)),
        evidence: patch.profile.evidence
          ? [...(existingOverride?.profile?.evidence || []), ...patch.profile.evidence].slice(-40)
          : existingOverride?.profile?.evidence || member.profile?.evidence
      }
    : existingOverride?.profile;
  const previousNames = new Set([...(existingOverride?.previousNames || []), member.displayName]);
  const nextOverrides: MemberOverride[] = [
    ...overrides.filter((item) => item.memberId !== memberId),
    {
      avatarSeed,
      displayName,
      memberId,
      previousNames: [...previousNames].filter((name) => name !== displayName),
      profile,
      updatedAt: now.toISOString()
    }
  ];
  await mkdir(dataDir, { recursive: true });
  const removedMemberIds = await readRemovedMemberIds(dataDir);
  await writeFile(`${dataDir}/member-overrides.json`, `${JSON.stringify({ members: nextOverrides, removedMemberIds }, null, 2)}\n`, "utf8");
  return { avatarSeed, displayName, memberId };
}

function resolveMember(members: FamilyMember[], overrides: MemberOverride[], query: string) {
  const normalized = query.trim();
  const legacyAssistantMatch = new RegExp(`饭米粒|小范大人|${DEFAULT_ASSISTANT_NAME}|fanmili`, "i").test(normalized)
    ? members.find((member) => member.id === "fanmili")
    : null;
  return (
    members.find((member) => member.id === normalized || member.displayName === normalized || normalized.includes(member.displayName)) ||
    legacyAssistantMatch ||
    overrides
      .map((override) => ({
        override,
        member: members.find((item) => item.id === override.memberId)
      }))
      .find((item) => item.member && item.override.previousNames.some((name) => normalized.includes(name)))?.member ||
    null
  );
}
