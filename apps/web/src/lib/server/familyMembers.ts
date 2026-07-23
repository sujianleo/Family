import type { FamilyMember } from "../types";
import type { FamilyRequestContext } from "./familyRequestContext";
import { readLiteFamilyMembers } from "./liteRepository";

export async function readFamilyMembersForContext(_context: FamilyRequestContext): Promise<FamilyMember[]> {
  return readLiteFamilyMembers();
}
