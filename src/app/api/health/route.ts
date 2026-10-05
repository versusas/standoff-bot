import { setupBot, getBot } from "@/lib/telegram-bot";

export async function GET() {
  if (!getBot() && process.env.TELEGRAM_BOT_TOKEN) {
    await setupBot();
  }
  return Response.json({ ok: true, bot: !!getBot() });
}
