import { Telegraf } from "telegraf";
import crypto from "crypto";
import { db } from "@/db";
import { sessions } from "@/db/schema";

const botToken = process.env.TELEGRAM_BOT_TOKEN;

let botInstance: Telegraf | null = null;

export function getBot(): Telegraf | null {
  return botInstance;
}

export function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return "http://localhost:3000";
}

export function createBot(): Telegraf {
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  if (botInstance) return botInstance;

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
        `✂️ Обрежу чёрный экран в конце первого видео\n` +
        `🔗 Склею два видео без видимого перехода\n` +
        `📸 Сделаю скриншоты фазы покупки и вкладок\n` +
        `☁️ Загружу и дам ссылку\n\n` +
        `📲 Открой ссылку и загрузи 2 видео:\n\n` +
        `${uploadUrl}\n\n` +
        `⏱ Обработка ~5 минут. Результат пришлю сюда.`
      );
    } catch (err) {
      console.error("start error:", err);
      await ctx.reply("❌ Произошла ошибка. Попробуй ещё раз.");
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

      await ctx.reply(`📲 Ссылка для загрузки:\n\n${uploadUrl}`);
    } catch (err) {
      console.error("upload command error:", err);
      await ctx.reply("❌ Ошибка. Попробуй ещё раз.");
    }
  });

  bot.on("message", (ctx) => {
    ctx.reply(
      `📹 Для загрузки видео нужна ссылка.\n\nНажми /start`
    );
  });

  return bot;
}

export function setupBot() {
  if (!botToken) {
    console.warn("TELEGRAM_BOT_TOKEN is not set. Bot will not start.");
    return;
  }
  if (botInstance) return;

  try {
    const bot = createBot();
    // Long polling mode
    bot.launch({ dropPendingUpdates: true });
    console.log("🤖 Telegram bot launched (polling)");

    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
  } catch (err) {
    console.error("Failed to start bot:", err);
  }
}

export async function sendMessage(chatId: number, text: string) {
  if (!botInstance) {
    console.warn("Bot not running, cannot sendMessage");
    return;
  }
  try {
    await botInstance.telegram.sendMessage(chatId, text);
  } catch (err) {
    console.error("sendMessage error:", err);
  }
}

export async function sendPhoto(chatId: number, photoPath: string, caption?: string) {
  if (!botInstance) {
    console.warn("Bot not running, cannot sendPhoto");
    return;
  }
  try {
    const fs = await import("fs");
    if (!fs.existsSync(photoPath)) {
      console.warn("Photo file not found:", photoPath);
      return;
    }
    await botInstance.telegram.sendPhoto(
      chatId,
      { source: fs.createReadStream(photoPath) },
      { caption }
    );
  } catch (err) {
    console.error("sendPhoto error:", err);
  }
}
