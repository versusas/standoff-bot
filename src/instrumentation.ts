export async function register() {
  // Only run on the server side, not during build
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { setupBot } = await import("@/lib/telegram-bot");
    setupBot();
  }
}
