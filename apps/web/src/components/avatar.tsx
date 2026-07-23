import { familyAvatarRoles, resolveAvatarRole } from "../lib/avatarCatalog";
import type { FamilyMember } from "@/lib/types";
import type { ComponentPropsWithoutRef } from "react";

const avatarAssetVersion = "19";

export const familyAvatarSeeds = familyAvatarRoles.map((role) => role.key);
const familyAvatarSeedSet = new Set<string>(familyAvatarSeeds);

export function resolveMemberAvatarSeed(member: Pick<FamilyMember, "avatarSeed" | "id">) {
  return resolveAvatarRole(familyAvatarSeedSet.has(member.avatarSeed) ? member.avatarSeed : member.id || member.avatarSeed).key;
}

export function avatarUrl(seed: string, label = "", variant: "color" | "mono" = "color"): string {
  const normalizedSeed = seed.trim();
  if (/^data:image\//i.test(normalizedSeed) || /^(?:https?:)?\/\//i.test(normalizedSeed)) {
    return normalizedSeed;
  }
  let resolvedSeed = normalizedSeed;
  if (/^\/avator\//.test(normalizedSeed)) {
    resolvedSeed = normalizedSeed.split("/").pop()?.replace(/\.(png|svg)(\?.*)?$/i, "") || "";
  }
  const role = resolveAvatarRole(resolvedSeed || label.trim() || "family");
  return `/avator/${role.key}.png?v=${avatarAssetVersion}&variant=${variant}`;
}

type AvatarImageProps = Omit<ComponentPropsWithoutRef<"img">, "src"> & { label?: string; seed: string };

export function AvatarImage({ className = "", label = "", seed, ...props }: AvatarImageProps) {
  return (
    <>
      <img {...props} className={`${className} avatar-image-color`.trim()} src={avatarUrl(seed, label, "color")} />
      <img {...props} aria-hidden="true" alt="" className={`${className} avatar-image-mono`.trim()} src={avatarUrl(seed, label, "mono")} />
    </>
  );
}

type MemberAvatarProps = {
  member: FamilyMember;
};

export function MemberAvatar({ member }: MemberAvatarProps) {
  return (
    <AvatarImage
      alt=""
      className="member-avatar-image"
      decoding="sync"
      fetchPriority="high"
      seed={resolveMemberAvatarSeed(member)}
      label={member.displayName}
      loading="eager"
    />
  );
}
