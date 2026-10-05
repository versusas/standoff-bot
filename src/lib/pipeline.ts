import fs from "fs";
import path from "path";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  findBlackScreenAtEnd,
  findGameplayStart,
  trimVideoEnd,
  trimVideoStart,
  detectSceneChanges,
  extractFrame,
  mergeVideos,
} from "./video-processor";
import { uploadToGoFile } from "./gofile";

async function updateJob(
  jobId: number,
  data: Partial<{
    status: string;
    statusMessage: string;
    mergedVideoUrl: string;
    screenshots: string[];
    errorMessage: string;
    trimPoint: string;
  }>
) {
  await db
    .update(jobs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

export interface ProcessResult {
  mergedVideoPath: string;
  screenshotPaths: string[];
  gofileUrl: string;
}

/**
 * Main processing pipeline:
 * 
 * VIDEO 1: Системные настройки → открытие игры → ЧЁРНЫЙ ЭКРАН
 *   → Обрезаем чёрный экран В КОНЦЕ (оставляем всё до него)
 * 
 * VIDEO 2: Загрузка игры (чёрный/логотип) → ГЕЙМПЛЕЙ → вкладки
 *   → Обрезаем загрузку В НАЧАЛЕ (оставляем с геймплея)
 *   → Делаем скриншоты фазы покупки + вкладок
 * 
 * MERGE: Video1 (до чёрного) + Video2 (с геймплея) = плавный переход
 */
export async function processVideos(
  jobId: number,
  video1Path: string,
  video2Path: string
): Promise<ProcessResult> {
  const workDir = path.dirname(video1Path);

  try {
    // ====== STEP 1: Analyze both videos in parallel ======
    await updateJob(jobId, {
      status: "detecting",
      statusMessage: "🔍 Анализирую оба видео...",
    });

    const [cutEndAt, cutStartAt, sceneTimestamps] = await Promise.all([
      findBlackScreenAtEnd(video1Path),
      findGameplayStart(video2Path),
      detectSceneChanges(video2Path),
    ]);

    console.log(`Video 1: cut at ${cutEndAt}s (black screen start)`);
    console.log(`Video 2: start at ${cutStartAt}s (gameplay start)`);
    console.log(`Scene changes: ${sceneTimestamps.length}`);

    await updateJob(jobId, {
      trimPoint: `V1 до ${cutEndAt.toFixed(1)}с | V2 с ${cutStartAt.toFixed(1)}с`,
      statusMessage: `✂️ V1: обрезаю после ${cutEndAt.toFixed(1)}с | V2: обрезаю до ${cutStartAt.toFixed(1)}с`,
    });

    // ====== STEP 2: Trim both videos in parallel ======
    await updateJob(jobId, {
      status: "trimming",
      statusMessage: "✂️ Обрезаю оба видео...",
    });

    const trimmed1 = path.join(workDir, "trimmed1.mp4");
    const trimmed2 = path.join(workDir, "trimmed2.mp4");

    await Promise.all([
      trimVideoEnd(video1Path, cutEndAt, trimmed1),
      trimVideoStart(video2Path, cutStartAt, trimmed2),
    ]);

    console.log("Both videos trimmed");

    // ====== STEP 3: Extract screenshots from video 2 ======
    await updateJob(jobId, {
      status: "screenshots",
      statusMessage: `📸 Делаю скриншоты (${sceneTimestamps.length} моментов)...`,
    });

    const screenshotPaths: string[] = [];
    for (let i = 0; i < sceneTimestamps.length; i++) {
      const ts = sceneTimestamps[i];
      const ssPath = path.join(workDir, `screen_${i + 1}.png`);
      try {
        await extractFrame(video2Path, ts, ssPath);
        if (fs.existsSync(ssPath)) {
          screenshotPaths.push(ssPath);
          console.log(`Screenshot ${i + 1} at ${ts.toFixed(1)}s`);
        }
      } catch (err) {
        console.error(`Failed screenshot at ${ts}s:`, err);
      }
    }

    // ====== STEP 4: Merge videos seamlessly ======
    await updateJob(jobId, {
      status: "merging",
      statusMessage: "🔗 Склеиваю видео (без видимого перехода)...",
    });

    const mergedPath = path.join(workDir, "merged.mp4");
    await mergeVideos(trimmed1, trimmed2, mergedPath);
    console.log("Videos merged seamlessly");

    // ====== STEP 5: Upload to GoFile ======
    await updateJob(jobId, {
      status: "uploading",
      statusMessage: "☁️ Загружаю видео...",
    });

    const gofileResult = await uploadToGoFile(mergedPath);

    // ====== DONE ======
    await updateJob(jobId, {
      status: "completed",
      statusMessage: "✅ Готово!",
      mergedVideoUrl: gofileResult.downloadPage,
      screenshots: screenshotPaths,
    });

    // Cleanup temp files
    for (const f of [video1Path, video2Path, trimmed1, trimmed2]) {
      try { fs.unlinkSync(f); } catch { /* */ }
    }

    return {
      mergedVideoPath: mergedPath,
      screenshotPaths,
      gofileUrl: gofileResult.downloadPage,
    };
  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);
    const message = error instanceof Error ? error.message : String(error);
    await updateJob(jobId, {
      status: "error",
      statusMessage: "❌ Ошибка",
      errorMessage: message,
    });
    throw error;
  }
}
