export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordRuntimeEvent } = await import("@/lib/server/runtimeLog");
  await recordRuntimeEvent({
    event: "process.started",
    metadata: { nodeEnv: process.env.NODE_ENV || "unknown" },
    source: "app",
    status: "started"
  });
  const { startLocalNotificationDispatcher } = await import("@/lib/server/localNotificationDispatcher");
  startLocalNotificationDispatcher();
  const { startAssistantScheduler } = await import("@/lib/server/assistantScheduler");
  const { runAutomationAction } = await import("@/lib/server/automationRunner");
  startAssistantScheduler(async (actionId, parameters) => {
    await runAutomationAction(actionId, {
      confirmed: true,
      parameters
    });
  });
}
