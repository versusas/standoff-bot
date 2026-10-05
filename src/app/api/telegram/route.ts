import { NextResponse } from "next/server";
import { handleTelegramUpdate, setupBot } from "@/lib/telegram-bot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  await setupBot();
  return NextResponse.json({ ok: true, mode: "webhook" });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    await setupBot();
    await handleTelegramUpdate(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
