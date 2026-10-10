// Starts the in-process job scheduler (hold expiry, WhatsApp reminders, offer expiry) once per server.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DISABLE_SCHEDULER === "true") return;
  const { startScheduler } = await import("./src/server/scheduler");
  startScheduler();
}
