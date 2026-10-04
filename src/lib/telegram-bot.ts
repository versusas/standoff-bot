import { Telegraf, Context, session } from "telegraf";
import { message } from "telegraf/filters";
import fs from "fs";
import path from "path";
import axios from "axios";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { processVideos } from "./pipeline";

interface SessionData {
  video1Path?: string;
  video1Name?: string;
  workDir?: string;
}

interface MyContext extends Context {
  session?: SessionData;
}

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  console.warn("TELEGRAM_BOT_TOKEN is not set. Telegram bot will not start.");
}

async function downloadTelegramFile(
  fileLink: string,
  savePath: string
): Promise<void> {
  const response = await axios({
    method: "GET",
    url: fileLink,
    responseType: "stream",
    timeout: 300000,
  });

  const writer = fs.createWriteStream(savePath);
  response.data.pipe(writer);

  await new Promise<void>((resolve, reject) => {
    writer.on("finish", () => resolve());
    writer.on("error", reject);
  });
}

async function handleVideo(ctx: MyContext, fileId: string, fileName: string) {
  try {
    const fileLink = await ctx.telegram.getFileLink(fileId);

    // First video - create workdir and save
    if (!ctx.session?.video1Path) {
      const workDir = path.join("/tmp", `tg_${ctx.from!.id}_${Date.now()}`);
      fs.mkdirSync(workDir, { recursive: true });
      const filePath = path.join(workDir, "video1.mp4");

      await ctx.reply(`📥 Загружаю первое видео...`);
      await downloadTelegramFile(fileLink.href, filePath);

      const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
      ctx.session = {
        video1Path: filePath,
        video1Name: fileName,
        workDir: workDir,
      };

      await ctx.reply(
        `✅ Первое видео получено (${sizeMB} МБ)!\n\n` +
          `Теперь пришли ВТОРОЕ видео (с переключением вкладок).`
      );
      return;
    }

    // Second video
    const workDir = ctx.session.workDir!;
    const video1Path = ctx.session.video1Path!;
    const video2Path = path.join(workDir, "video2.mp4");

    await ctx.reply(`📥 Загружаю второе видео...`);
    await downloadTelegramFile(fileLink.href, video2Path);

    const sizeMB = (fs.statSync(video2Path).size / 1024 / 1024).toFixed(1);
    await ctx.reply(
      `✅ Второе видео получено (${sizeMB} МБ)!\n\n` +
        `🚀 Начинаю обработку... Это займет ~5 минут.\n` +
        `Я пришлю скриншоты и ссылку на видео когда всё будет готово.`
    );

    // Clear session immediately so user can start new job
    ctx.session = {};

    // Create job
    const [job] = await db
      .insert(jobs)
      .values({
        status: "processing",
        statusMessage: "Начинаю обработку...",
        video1Name: ctx.session?.video1Name || "video1.mp4",
        video2Name: fileName,
      })
      .returning();

    // Process in background
    const chatId = ctx.chat!.id;
    const telegram = ctx.telegram;

    processVideos(job.id, video1Path, video2Path)
      .then(async (result) => {
        // Send screenshots directly to chat
        if (result.screenshotPaths.length > 0) {
          await telegram.sendMessage(chatId, `📸 Скриншоты (${result.screenshotPaths.length} шт.):`);

          for (let i = 0; i < result.screenshotPaths.length; i++) {
            const ssPath = result.screenshotPaths[i];
            if (fs.existsSync(ssPath)) {
              try {
                await telegram.sendPhoto(chatId, {
                  source: fs.createReadStream(ssPath),
                }, {
                  caption: `Скриншот ${i + 1}`,
                });
              } catch (err) {
                console.error(`Failed to send screenshot ${i + 1}:`, err);
              }
            }
          }
        }

        // Send GoFile link
        await telegram.sendMessage(
          chatId,
          `✅ Обработка завершена!\n\n` +
            `🎬 Склеенное видео: ${result.gofileUrl}\n\n` +
            `Ссылку можно скинуть кому угодно — видео доступно всем.`
        );

        // Cleanup
        try {
          fs.rmSync(workDir, { recursive: true, force: true });
        } catch { /* */ }
      })
      .catch(async (err) => {
        console.error("Processing error:", err);
        await telegram.sendMessage(
          chatId,
          `❌ Ошибка обработки: ${err.message}\n\nПопробуй ещё раз: /start`
        );
      });
  } catch (err) {
    console.error("Video download error:", err);
    await ctx.reply("❌ Ошибка при загрузке видео. Попробуй ещё раз.");
    ctx.session = {};
  }
}

export function setupBot() {
  if (!botToken) return;

  const bot = new Telegraf<MyContext>(botToken);
  bot.use(session({ defaultSession: () => ({}) }));

  bot.start((ctx) => {
    ctx.reply(
      `🎮 Привет! Я обработаю твои записи из Standoff 2.\n\n` +
        `Что я делаю:\n` +
        `• Обрезаю чёрный экран в начале\n` +
        `• Склеиваю два видео в одно\n` +
        `• Делаю скриншоты вкладок и фазы покупки\n` +
        `• Загружаю видео и кидаю ссылку\n\n` +
        `📹 Пришли мне ПЕРВОЕ видео (с чёрным экраном в начале).`
    );
  });

  bot.command("reset", (ctx) => {
    ctx.session = {};
    ctx.reply("🔄 Сброшено. Пришли первое видео.");
  });

  // Handle video messages (compressed)
  bot.on(message("video"), async (ctx) => {
    const video = ctx.message.video;
    const fileName = video.file_name || `video_${Date.now()}.mp4`;
    await handleVideo(ctx, video.file_id, fileName);
  });

  // Handle document messages (uncompressed video files)
  bot.on(message("document"), async (ctx) => {
    const doc = ctx.message.document;
    const mime = doc.mime_type || "";

    if (!mime.startsWith("video/")) {
      await ctx.reply("⚠️ Пришли видеофайл (mp4, mkv и т.д.)");
      return;
    }

    const fileName = doc.file_name || `video_${Date.now()}.mp4`;
    await handleVideo(ctx, doc.file_id, fileName);
  });

  bot.on("message", (ctx) => {
    ctx.reply("📹 Пришли видеофайл. Если хочешь начать заново — /reset");
  });

  bot.launch();
  console.log("🤖 Telegram bot launched!");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
