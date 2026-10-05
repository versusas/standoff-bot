import { setupBot, getBot } from "@/lib/telegram-bot";

export async function GET() {
  // Fallback: if instrumentation didn't start the bot, start it here
  if (!getBot() && process.env.TELEGRAM_BOT_TOKEN) {
    console.log("Health: starting bot as fallback...");
    setupBot();
  }

  return Response.json({
    ok: true,
    botActive: !!getBot(),
    time: new Date().toISOString(),
  });
}
