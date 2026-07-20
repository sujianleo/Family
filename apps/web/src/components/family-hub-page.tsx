import type { FamilyMember, FamilyRecord } from "@/lib/types";
import { FamilyAccessGate } from "./family-access-gate";
import { RecordList } from "./record-list";
import { NotificationCenter } from "./notification-center";
import { OnboardingGate } from "./onboarding-gate";
import { PwaInstallPrompt } from "./pwa-install-prompt";

export type NavItem = {
  label: string;
  count: number;
};

type FamilyHubPageProps = {
  demoDataEnabled: boolean;
  demoRecordIds: string[];
  familyMembers: FamilyMember[];
  familyRecords: FamilyRecord[];
  initialMemberId: string;
  initialSignedIn: boolean;
  navItems: NavItem[];
};

export function FamilyHubPage({
  demoDataEnabled,
  demoRecordIds,
  familyMembers,
  familyRecords,
  initialMemberId,
  initialSignedIn,
  navItems
}: FamilyHubPageProps) {
  return (
    <FamilyAccessGate initialSignedIn={initialSignedIn}>
      <OnboardingGate>
        <NotificationCenter members={familyMembers} />
        <PwaInstallPrompt />
        <main className="app-shell">
          <section className="workspace">
            <div className="columns">
              <RecordList
                demoDataEnabled={demoDataEnabled}
                demoRecordIds={demoRecordIds}
                initialMemberId={initialMemberId}
                members={familyMembers}
                navItems={navItems}
                records={familyRecords}
              />
            </div>
          </section>
        </main>
      </OnboardingGate>
    </FamilyAccessGate>
  );
}
