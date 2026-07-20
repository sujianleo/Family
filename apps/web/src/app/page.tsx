import { familyRecords } from "@/lib/mockData";
import { FamilyHubPage, type NavItem } from "@/components/family-hub-page";
import { readFamilyMembersWithOverrides } from "@/lib/server/memberOverrides";
import { isLocalAuthConfigured, readLocalSession } from "@/lib/server/localAuth";
import { headers } from "next/headers";
import { connection } from "next/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await connection();
  const [membersWithOverrides, requestHeaders] = await Promise.all([
    readFamilyMembersWithOverrides("data"),
    headers()
  ]);
  const localAuthConfigured = isLocalAuthConfigured();
  const session = readLocalSession(new Request("http://family-app.local/", { headers: requestHeaders }));
  const initialSignedIn = !localAuthConfigured || Boolean(session);
  const initialMemberId = session?.memberId || process.env.NEXT_PUBLIC_SUPABASE_MEMBER_ID || "me";
  const initialRecords = localAuthConfigured ? [] : familyRecords;
  const navItems: NavItem[] = [
    { label: "任务", count: initialRecords.filter((item) => item.kind === "task" && !(item.inviteLink || item.chatMembers?.length)).length },
    { label: "群组", count: initialRecords.filter((item) => item.inviteLink || item.chatMembers?.length).length }
  ];
  return (
    <FamilyHubPage
      familyMembers={membersWithOverrides}
      familyRecords={initialRecords}
      initialMemberId={initialMemberId}
      initialSignedIn={initialSignedIn}
      navItems={navItems}
    />
  );
}
