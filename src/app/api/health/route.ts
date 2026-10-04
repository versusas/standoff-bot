import { setupBot } from "@/lib/telegram-bot";

let botStarted = false;

export async function GET() {
  if (!botStarted && process.env.TELEGRAM_BOT_TOKEN) {
    try {
      setupBot();
      botStarted = true;
      console.log("Bot started via health check");
    } catch (e) {
      console.error("Failed to start bot:", e);
    }
  }

  return Response.json({ ok: true, botActive: botStarted });
}
