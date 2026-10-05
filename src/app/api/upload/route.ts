import { NextResponse, NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { db, ensureTables } from "@/db";
import { jobs, sessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { processVideos } from "@/lib/pipeline";
import { sendMessage, sendPhoto } from "@/lib/telegram-bot";

// Route segment config
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  await ensureTables();

  try {
    console.log("Upload: reading form data...");
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

    console.log(`Upload: got ${video1.name} (${(video1.size / 1024 / 1024).toFixed(1)}MB) + ${video2.name} (${(video2.size / 1024 / 1024).toFixed(1)}MB)`);

    // Look up session
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

    // Save files to disk
    const jobDir = path.join("/tmp", `job_${Date.now()}`);
    fs.mkdirSync(jobDir, { recursive: true });

    const video1Path = path.join(jobDir, "video1.mp4");
    const video2Path = path.join(jobDir, "video2.mp4");

    // Stream files to disk instead of loading into memory
    console.log("Upload: saving files to disk...");

    const [bytes1, bytes2] = await Promise.all([
      video1.bytes(),
      video2.bytes(),
    ]);

    fs.writeFileSync(video1Path, Buffer.from(bytes1));
    fs.writeFileSync(video2Path, Buffer.from(bytes2));

    const size1 = (bytes1.length / 1024 / 1024).toFixed(1);
    const size2 = (bytes2.length / 1024 / 1024).toFixed(1);

    console.log(`Upload: saved ${size1}MB + ${size2}MB`);

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

    console.log(`Upload: job #${job.id} created`);

    // Notify Telegram
    if (chatId) {
      sendMessage(
        chatId,
        `📤 Видео получены (${size1}МБ + ${size2}МБ)!\n⏳ Начинаю обработку...`
      ).catch(() => {});
    }

    // Process in background - DON'T await
    processVideos(job.id, video1Path, video2Path)
      .then(async (result) => {
        if (!chatId) return;

        // Send screenshots
        console.log(`Sending ${result.screenshotPaths.length} screenshots to chat ${chatId}`);
        if (result.screenshotPaths.length > 0) {
          await sendMessage(chatId, `📸 Скриншоты (${result.screenshotPaths.length}):`);
          for (let i = 0; i < result.screenshotPaths.length; i++) {
            console.log(`Sending screenshot ${i+1}: ${result.screenshotPaths[i]}, exists=${fs.existsSync(result.screenshotPaths[i])}`);
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
        console.error("Processing failed:", err);
        if (chatId) {
          await sendMessage(chatId, `❌ Ошибка: ${err.message}\n\nНажми /start и попробуй ещё.`);
        }
      });

    // Return immediately - don't wait for processing
    return NextResponse.json({ jobId: job.id, message: "Обработка начата!" });
  } catch (error) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
