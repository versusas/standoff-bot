export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("⚡ Instrumentation: starting bot...");
    const { setupBot } = await import("@/lib/telegram-bot");
    await setupBot();
  }
}
