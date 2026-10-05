import { Telegraf } from "telegraf";
import crypto from "crypto";
import { db, ensureTables } from "@/db";
import { sessions } from "@/db/schema";

const botToken = process.env.TELEGRAM_BOT_TOKEN;

let botInstance: Telegraf | null = null;

export function getBot(): Telegraf | null {
  return botInstance;
}

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return "http://localhost:3000";
}

export async function setupBot() {
  if (!botToken) {
    console.warn("TELEGRAM_BOT_TOKEN is not set.");
    return;
  }
  if (botInstance) return;

  // Create tables first
  await ensureTables();

  console.log("🚀 Starting Telegram bot...");

  const bot = new Telegraf(botToken);
  botInstance = bot;

  bot.start(async (ctx) => {
    try {
      const token = crypto.randomBytes(16).toString("hex");
      const chatId = ctx.chat.id;
      const username = ctx.from?.username || ctx.from?.first_name || "User";

      await db.insert(sessions).values({
        token,
        chatId,
        username,
        status: "waiting",
      });

      const uploadUrl = `${getAppUrl()}/upload/${token}`;

      await ctx.reply(
        `🎮 Привет, ${username}!\n\n` +
        `Я обработаю твои записи Standoff 2:\n` +
        `✂️ Обрежу чёрный экран\n` +
        `🔗 Склею два видео\n` +
        `📸 Скриншоты фазы покупки и вкладок\n` +
        `☁️ Загружу и дам ссылку\n\n` +
        `📲 Открой ссылку и загрузи 2 видео:\n\n` +
        `${uploadUrl}\n\n` +
        `⏱ Результат пришлю сюда через ~5 мин.`
      );
    } catch (err) {
      console.error("Bot /start error:", err);
      await ctx.reply("❌ Ошибка. Попробуй /start ещё раз через минуту.");
    }
  });

  bot.command("upload", async (ctx) => {
    try {
      const token = crypto.randomBytes(16).toString("hex");
      const chatId = ctx.chat.id;
      const username = ctx.from?.username || ctx.from?.first_name || "User";

      await db.insert(sessions).values({
        token,
        chatId,
        username,
        status: "waiting",
      });

      const uploadUrl = `${getAppUrl()}/upload/${token}`;
      await ctx.reply(`📲 Ссылка:\n\n${uploadUrl}`);
    } catch (err) {
      console.error("Bot /upload error:", err);
      await ctx.reply("❌ Ошибка.");
    }
  });

  bot.on("message", (ctx) => {
    ctx.reply("Нажми /start чтобы получить ссылку для загрузки видео.");
  });

  try {
    await bot.launch({ dropPendingUpdates: true });
    console.log("✅ Telegram bot is running!");
  } catch (err) {
    console.error("❌ Bot launch failed:", err);
    botInstance = null;
  }

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

export async function sendMessage(chatId: number, text: string) {
  if (!botInstance) return;
  try {
    await botInstance.telegram.sendMessage(chatId, text);
  } catch (err) {
    console.error("sendMessage error:", err);
  }
}

export async function sendPhoto(chatId: number, photoPath: string, caption?: string) {
  if (!botInstance) return;
  try {
    const fs = await import("fs");
    if (!fs.existsSync(photoPath)) return;
    await botInstance.telegram.sendPhoto(
      chatId,
      { source: fs.createReadStream(photoPath) },
      { caption }
    );
  } catch (err) {
    console.error("sendPhoto error:", err);
  }
}
