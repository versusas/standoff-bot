import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db, ensureTables } from "@/db";
import { jobs, sessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { processVideos } from "@/lib/pipeline";
import { sendMessage, sendPhoto } from "@/lib/telegram-bot";

export async function POST(request: Request) {
  await ensureTables();
  try {
    const formData = await request.formData();
    const video1 = formData.get("video1") as File | null;
    const video2 = formData.get("video2") as File | null;
    const token = formData.get("token") as string | null;

    if (!video1 || !video2) {
      return NextResponse.json(
        { error: "Нужно загрузить оба видео" },
        { status: 400 }
      );
    }

    // Look up session for Telegram chat
    let chatId: number | null = null;
    if (token) {
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.token, token));
      if (session) {
        chatId = session.chatId;
      }
    }

    // Save files
    const jobDir = path.join("/tmp", `job_${Date.now()}`);
    fs.mkdirSync(jobDir, { recursive: true });

    const video1Path = path.join(jobDir, "video1.mp4");
    const video2Path = path.join(jobDir, "video2.mp4");

    const [buf1, buf2] = await Promise.all([
      video1.arrayBuffer(),
      video2.arrayBuffer(),
    ]);

    fs.writeFileSync(video1Path, Buffer.from(buf1));
    fs.writeFileSync(video2Path, Buffer.from(buf2));

    const size1 = (buf1.byteLength / 1024 / 1024).toFixed(1);
    const size2 = (buf2.byteLength / 1024 / 1024).toFixed(1);
    console.log(`Files: ${video1.name} (${size1}MB), ${video2.name} (${size2}MB)`);

    // Create job
    const [job] = await db
      .insert(jobs)
      .values({
        status: "processing",
        statusMessage: "📤 Файлы загружены, начинаю обработку...",
        video1Name: video1.name,
        video2Name: video2.name,
      })
      .returning();

    // Notify Telegram
    if (chatId) {
      await sendMessage(
        chatId,
        `📤 Видео получены (${size1}МБ + ${size2}МБ)!\n⏳ Начинаю обработку...`
      );
    }

    // Process in background
    processVideos(job.id, video1Path, video2Path)
      .then(async (result) => {
        if (!chatId) return;

        // Send screenshots to Telegram chat
        if (result.screenshotPaths.length > 0) {
          await sendMessage(chatId, `📸 Скриншоты (${result.screenshotPaths.length}):`);
          for (let i = 0; i < result.screenshotPaths.length; i++) {
            await sendPhoto(chatId, result.screenshotPaths[i], `Скриншот ${i + 1}`);
          }
        }

        // Send GoFile link
        await sendMessage(
          chatId,
          `✅ Готово!\n\n🎬 Видео: ${result.gofileUrl}\n\nСсылку можно кинуть кому угодно.`
        );

        // Cleanup
        try {
          fs.rmSync(jobDir, { recursive: true, force: true });
        } catch { /* */ }
      })
      .catch(async (err) => {
        if (chatId) {
          await sendMessage(chatId, `❌ Ошибка: ${err.message}\n\nНажми /start и попробуй ещё.`);
        }
      });

    return NextResponse.json({ jobId: job.id, message: "Обработка начата!" });
  } catch (error) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
