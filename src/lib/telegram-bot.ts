import { Telegraf } from "telegraf";
import type { Update } from "telegraf/types";
import crypto from "crypto";
import { db, ensureTables } from "@/db";
import { sessions } from "@/db/schema";

const botToken = process.env.TELEGRAM_BOT_TOKEN;
let botInstance: Telegraf | null = null;
let webhookConfigured = false;

export function getBot(): Telegraf | null {
  return botInstance;
}

export function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  return "http://localhost:3000";
}

function registerHandlers(bot: Telegraf) {
  bot.catch((err) => {
    console.error("Telegram bot handler error:", err);
  });

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
          `📸 Сделаю скриншоты фазы покупки и вкладок\n` +
          `☁️ Загружу видео и дам ссылку\n\n` +
          `📲 Открой ссылку и загрузи 2 видео:\n\n` +
          `${uploadUrl}\n\n` +
          `⏱ Результат пришлю сюда через ~5 минут.`
      );
    } catch (err) {
      console.error("Bot /start error:", err);
      await ctx.reply("❌ Ошибка. Попробуй /start ещё раз.");
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
      console.error("Bot /upload error:", err);
      await ctx.reply("❌ Ошибка. Попробуй ещё раз.");
    }
  });

  bot.on("message", async (ctx) => {
    await ctx.reply("Нажми /start чтобы получить ссылку для загрузки видео.");
  });
}

export function createBot(): Telegraf {
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set");
  }

  if (botInstance) {
    return botInstance;
  }

  const bot = new Telegraf(botToken);
  registerHandlers(bot);
  botInstance = bot;
  return bot;
}

export async function ensureWebhook() {
  if (!botToken) {
    console.warn("TELEGRAM_BOT_TOKEN is not set.");
    return;
  }

  const bot = createBot();
  const webhookUrl = `${getAppUrl()}/api/telegram`;

  try {
    const info = await bot.telegram.getWebhookInfo();
    if (info.url === webhookUrl) {
      webhookConfigured = true;
      console.log(`✅ Telegram webhook already configured: ${webhookUrl}`);
      return;
    }

    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.telegram.setWebhook(webhookUrl, {
      drop_pending_updates: true,
      allowed_updates: ["message"],
    });

    webhookConfigured = true;
    console.log(`✅ Telegram webhook set: ${webhookUrl}`);
  } catch (err) {
    console.error("❌ Failed to configure Telegram webhook:", err);
    webhookConfigured = false;
  }
}

export async function setupBot() {
  try {
    await ensureTables();

    if (!botToken) {
      console.warn("Telegram bot skipped: TELEGRAM_BOT_TOKEN is not set");
      return;
    }

    createBot();
    await ensureWebhook();
    console.log(`🤖 Telegram bot ready in webhook mode (${webhookConfigured ? "configured" : "not configured"})`);
  } catch (error) {
    console.error("setupBot error:", error);
  }
}

export async function handleTelegramUpdate(update: Update) {
  const bot = createBot();
  await bot.handleUpdate(update);
}

export async function sendMessage(chatId: number, text: string) {
  try {
    const bot = createBot();
    await bot.telegram.sendMessage(chatId, text);
  } catch (err) {
    console.error("sendMessage error:", err);
  }
}

export async function sendPhoto(chatId: number, photoPath: string, caption?: string) {
  try {
    const fs = await import("fs");
    if (!fs.existsSync(photoPath)) return;

    const bot = createBot();
    await bot.telegram.sendPhoto(
      chatId,
      { source: fs.createReadStream(photoPath) },
      { caption }
    );
  } catch (err) {
    console.error("sendPhoto error:", err);
  }
}
