export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("🚀 Instrumentation: starting Telegram bot...");
    try {
      const { setupBot } = await import("@/lib/telegram-bot");
      setupBot();
    } catch (err) {
      console.error("Instrumentation bot error:", err);
    }
  }
}
