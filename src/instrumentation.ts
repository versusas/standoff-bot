export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("⚡ Instrumentation: preparing bot webhook + keep-alive...");

    try {
      const { setupBot } = await import("@/lib/telegram-bot");
      await setupBot();
    } catch (err) {
      console.error("Bot setup error:", err);
    }

    try {
      const { startKeepAlive } = await import("@/lib/keep-alive");
      startKeepAlive();
    } catch (err) {
      console.error("Keep-alive error:", err);
    }
  }
}
