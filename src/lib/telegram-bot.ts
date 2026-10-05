import { Telegraf } from "telegraf";
import crypto from "crypto";
import { db } from "@/db";
import { sessions } from "@/db/schema";

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  console.warn("TELEGRAM_BOT_TOKEN is not set. Telegram bot will not start.");
}

let botInstance: Telegraf | null = null;

export function getBot(): Telegraf | null {
  return botInstance;
}

export function setupBot() {
  if (!botToken) return;
  if (botInstance) return; // already running

  const bot = new Telegraf(botToken);
  botInstance = bot;

  bot.start(async (ctx) => {
    const token = crypto.randomBytes(16).toString("hex");
    const chatId = ctx.chat.id;
    const username = ctx.from?.username || ctx.from?.first_name || "User";

    // Save session
    await db.insert(sessions).values({
      token,
      chatId,
      username,
      status: "waiting",
    });

    const appUrl = process.env.APP_URL || process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "http://localhost:3000";

    const uploadUrl = `${appUrl}/upload/${token}`;

    await ctx.reply(
      `🎮 Привет, ${username}!\n\n` +
      `Я обработаю твои записи Standoff 2:\n` +
      `• Обрежу чёрный экран\n` +
      `• Склею два видео без видимого перехода\n` +
      `• Сделаю скриншоты фазы покупки и вкладок\n` +
      `• Загружу видео и дам ссылку\n\n` +
      `📲 Открой эту ссылку и загрузи 2 видео:\n\n` +
      `${uploadUrl}\n\n` +
      `⏱ Обработка займёт ~5 минут. Результат пришлю сюда.`
    );
  });

  bot.command("upload", async (ctx) => {
    const token = crypto.randomBytes(16).toString("hex");
    const chatId = ctx.chat.id;
    const username = ctx.from?.username || ctx.from?.first_name || "User";

    await db.insert(sessions).values({
      token,
      chatId,
      username,
      status: "waiting",
    });

    const appUrl = process.env.APP_URL || process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "http://localhost:3000";

    const uploadUrl = `${appUrl}/upload/${token}`;

    await ctx.reply(
      `📲 Новая ссылка для загрузки:\n\n${uploadUrl}\n\n` +
      `Открой её и загрузи 2 видео.`
    );
  });

  bot.on("message", (ctx) => {
    ctx.reply(
      `📹 Видео нужно загружать через ссылку (ограничение Telegram на размер файлов).\n\n` +
      `Нажми /start чтобы получить ссылку для загрузки.`
    );
  });

  bot.launch();
  console.log("🤖 Telegram bot launched!");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

/**
 * Send a message to a specific chat
 */
export async function sendMessage(chatId: number, text: string) {
  if (!botInstance) return;
  await botInstance.telegram.sendMessage(chatId, text);
}

/**
 * Send a photo to a specific chat
 */
export async function sendPhoto(chatId: number, photoPath: string, caption?: string) {
  if (!botInstance) return;
  const fs = await import("fs");
  if (!fs.existsSync(photoPath)) return;
  await botInstance.telegram.sendPhoto(
    chatId,
    { source: fs.createReadStream(photoPath) },
    { caption }
  );
}
