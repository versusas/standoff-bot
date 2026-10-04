import fs from "fs";
import path from "path";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  detectBlackScreenEnd,
  trimVideo,
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
 * 1. Detect black screen in video1 → trim
 * 2. Detect scene changes in video2 (tab switches + buy phase) → screenshots
 * 3. Merge trimmed video1 + video2
 * 4. Upload merged video to GoFile
 * 5. Return results
 */
export async function processVideos(
  jobId: number,
  video1Path: string,
  video2Path: string
): Promise<ProcessResult> {
  const workDir = path.dirname(video1Path);

  try {
    // ====== STEP 1: Detect black screen + scene changes (parallel) ======
    await updateJob(jobId, {
      status: "detecting",
      statusMessage: "🔍 Анализирую видео... Ищу чёрный экран и переключения вкладок",
    });

    const [blackScreenEnd, sceneTimestamps] = await Promise.all([
      detectBlackScreenEnd(video1Path),
      detectSceneChanges(video2Path),
    ]);

    console.log(`Black screen ends at: ${blackScreenEnd}s`);
    console.log(`Scene changes found: ${sceneTimestamps.length}`);

    await updateJob(jobId, {
      trimPoint: `${blackScreenEnd}s`,
      statusMessage: `✂️ Чёрный экран до ${blackScreenEnd.toFixed(1)}с. Обрезаю...`,
    });

    // ====== STEP 2: Trim video1 ======
    await updateJob(jobId, {
      status: "trimming",
      statusMessage: "✂️ Обрезаю первое видео...",
    });

    const trimmedPath = path.join(workDir, "trimmed_video1.mp4");
    await trimVideo(video1Path, blackScreenEnd, trimmedPath);
    console.log("Video 1 trimmed");

    // ====== STEP 3: Extract screenshots ======
    await updateJob(jobId, {
      status: "screenshots",
      statusMessage: `📸 Делаю скриншоты (${sceneTimestamps.length} моментов)...`,
    });

    const screenshotPaths: string[] = [];
    for (let i = 0; i < sceneTimestamps.length; i++) {
      const ts = sceneTimestamps[i];
      const screenshotPath = path.join(workDir, `screen_${i + 1}.png`);
      try {
        await extractFrame(video2Path, ts, screenshotPath);
        if (fs.existsSync(screenshotPath)) {
          screenshotPaths.push(screenshotPath);
          console.log(`Screenshot ${i + 1} at ${ts.toFixed(1)}s`);
        }
      } catch (err) {
        console.error(`Failed screenshot at ${ts}s:`, err);
      }
    }

    // ====== STEP 4: Merge videos ======
    await updateJob(jobId, {
      status: "merging",
      statusMessage: "🔗 Склеиваю видео...",
    });

    const mergedPath = path.join(workDir, "merged.mp4");
    await mergeVideos(trimmedPath, video2Path, mergedPath);
    console.log("Videos merged");

    // ====== STEP 5: Upload to GoFile ======
    await updateJob(jobId, {
      status: "uploading",
      statusMessage: "☁️ Загружаю видео на GoFile...",
    });

    const gofileResult = await uploadToGoFile(mergedPath);

    // ====== DONE ======
    await updateJob(jobId, {
      status: "completed",
      statusMessage: "✅ Готово!",
      mergedVideoUrl: gofileResult.downloadPage,
      screenshots: screenshotPaths,
    });

    // Cleanup source files
    try { fs.unlinkSync(video1Path); } catch { /* */ }
    try { fs.unlinkSync(video2Path); } catch { /* */ }
    try { fs.unlinkSync(trimmedPath); } catch { /* */ }

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
