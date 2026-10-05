import { ensureTables } from "@/db";

export async function GET() {
  try {
    await ensureTables();
  } catch (error) {
    console.error("Health DB init error:", error);
  }

  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const { setupBot } = await import("@/lib/telegram-bot");
      await setupBot();
    } catch (error) {
      console.error("Health bot setup error:", error);
    }
  }

  return Response.json({
    ok: true,
    mode: process.env.TELEGRAM_BOT_TOKEN ? "webhook" : "no-bot-token",
    time: new Date().toISOString(),
  });
}
