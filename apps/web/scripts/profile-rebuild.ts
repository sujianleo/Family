#!/usr/bin/env node

import { writeMemberProfiles } from "../src/lib/server/memberProfiles";

async function main() {
  const result = await writeMemberProfiles({ backup: true, force: true, useAi: false });
  console.log(
    JSON.stringify(
      {
        generatedAt: result.generated_at,
        profileCount: result.profiles.length,
        sourceEventCount: result.source_event_count,
        evidenceMetrics: result.evidence_metrics,
        status: result.status
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
