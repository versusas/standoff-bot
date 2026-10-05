import fs from "fs";
import path from "path";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  findCutPointVideo1,
  trimVideoEnd,
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
 * Pipeline:
 * 
 * V1: [настройки] → [открытие игры] → [ЧЁРНЫЙ ЭКРАН] → [логотип/загрузка]
 *   → Обрезаем логотип/загрузку ПОСЛЕ чёрного экрана
 *   → Чёрный экран ОСТАЁТСЯ (мост к V2)
 * 
 * V2: [ЧЁРНЫЙ ЭКРАН] → [загрузка] → [меню] → [геймплей] → [вкладки]
 *   → НЕ обрезаем начало — чёрный экран это мост от V1
 *   → Скриншоты: фаза покупки + вкладки
 * 
 * MERGE: V1(с чёрным в конце) + V2(с чёрным в начале) = плавный переход
 */
export async function processVideos(
  jobId: number,
  video1Path: string,
  video2Path: string
): Promise<ProcessResult> {
  const workDir = path.dirname(video1Path);

  try {
    // ====== STEP 1: Analyze V1 + detect scenes in V2 ======
    await updateJob(jobId, {
      status: "detecting",
      statusMessage: "🔍 Анализирую видео...",
    });

    const [cutV1At, sceneTimestamps] = await Promise.all([
      findCutPointVideo1(video1Path),
      detectSceneChanges(video2Path),
    ]);

    console.log(`V1: cut at ${cutV1At}s`);
    console.log(`V2: keep from start (black screen bridge)`);
    console.log(`Scene changes in V2: ${sceneTimestamps.length}`);

    await updateJob(jobId, {
      trimPoint: `V1 до ${cutV1At.toFixed(1)}с | V2 целиком`,
    });

    // ====== STEP 2: Trim V1 (remove logo/loading after black screen) ======
    await updateJob(jobId, {
      status: "trimming",
      statusMessage: "✂️ Обрезаю первое видео...",
    });

    const trimmed1 = path.join(workDir, "trimmed1.mp4");
    await trimVideoEnd(video1Path, cutV1At, trimmed1);

    // V2 is used as-is (no trimming — black screen at start is the bridge)

    // ====== STEP 3: Extract screenshots from V2 ======
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

    console.log(`Total screenshots: ${screenshotPaths.length}`);

    // ====== STEP 4: Merge V1(trimmed) + V2(full) ======
    await updateJob(jobId, {
      status: "merging",
      statusMessage: "🔗 Склеиваю видео...",
    });

    const mergedPath = path.join(workDir, "merged.mp4");
    await mergeVideos(trimmed1, video2Path, mergedPath);
    console.log("Merge complete");

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

    // Cleanup
    for (const f of [video1Path, video2Path, trimmed1]) {
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
