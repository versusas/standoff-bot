import { NextResponse, NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { db, ensureTables } from "@/db";
import { jobs, sessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { processVideos } from "@/lib/pipeline";
import { sendMessage, sendPhoto, getAppUrl } from "@/lib/telegram-bot";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  await ensureTables();

  try {
    const formData = await request.formData();
    const video1 = formData.get("video1") as File | null;
    const video2 = formData.get("video2") as File | null;
    const token = formData.get("token") as string | null;

    if (!video1 || !video2) {
      return NextResponse.json({ error: "Нужно загрузить оба видео" }, { status: 400 });
    }

    let chatId: number | null = null;
    if (token) {
      const [session] = await db.select().from(sessions).where(eq(sessions.token, token));
      if (session) chatId = session.chatId;
    }

    const jobDir = path.join("/tmp", `job_${Date.now()}`);
    fs.mkdirSync(jobDir, { recursive: true });

    const video1Path = path.join(jobDir, "video1.mp4");
    const video2Path = path.join(jobDir, "video2.mp4");

    const [bytes1, bytes2] = await Promise.all([video1.bytes(), video2.bytes()]);
    fs.writeFileSync(video1Path, Buffer.from(bytes1));
    fs.writeFileSync(video2Path, Buffer.from(bytes2));

    const size1 = (bytes1.length / 1024 / 1024).toFixed(1);
    const size2 = (bytes2.length / 1024 / 1024).toFixed(1);

    const [job] = await db
      .insert(jobs)
      .values({
        status: "processing",
        statusMessage: "📤 Файлы загружены, начинаю обработку...",
        video1Name: video1.name,
        video2Name: video2.name,
      })
      .returning();

    if (chatId) {
      sendMessage(chatId, `📤 Видео получены (${size1}МБ + ${size2}МБ)!\n⏳ Начинаю обработку...`).catch(() => {});
    }

    processVideos(job.id, video1Path, video2Path)
      .then(async (result) => {
        const publicVideoUrl = `${getAppUrl()}/api/files/${path.basename(result.mergedVideoPath)}?dir=${encodeURIComponent(path.dirname(result.mergedVideoPath))}`;

        await db
          .update(jobs)
          .set({ mergedVideoUrl: publicVideoUrl, updatedAt: new Date() })
          .where(eq(jobs.id, job.id));

        if (!chatId) return;

        console.log(`Sending ${result.screenshotPaths.length} screenshots to chat ${chatId}`);
        if (result.screenshotPaths.length > 0) {
          await sendMessage(chatId, `📸 Скриншоты (${result.screenshotPaths.length}):`);
          for (let i = 0; i < result.screenshotPaths.length; i++) {
            console.log(`Sending screenshot ${i + 1}: ${result.screenshotPaths[i]}, exists=${fs.existsSync(result.screenshotPaths[i])}`);
            await sendPhoto(chatId, result.screenshotPaths[i], `Скриншот ${i + 1}`);
          }
        } else {
          await sendMessage(chatId, `⚠️ Скриншоты не найдены автоматически.`);
        }

        await sendMessage(
          chatId,
          `✅ Готово!\n\n🎬 Видео: ${publicVideoUrl}\n\nЕсли ссылка не открывается сразу — подожди пару секунд и обнови.`
        );
      })
      .catch(async (err) => {
        console.error("Processing failed:", err);
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
