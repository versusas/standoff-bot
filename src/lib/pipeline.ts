import fs from "fs";
import path from "path";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  detectSceneChanges,
  extractFrame,
  findCutPointVideo1,
  getVideoDuration,
  mergeVideos,
  normalizeVideo,
  trimVideoEnd,
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

function uniqSortedTimestamps(values: number[], minGap = 3): number[] {
  const sorted = [...values].filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const result: number[] = [];
  for (const v of sorted) {
    if (result.length === 0 || v - result[result.length - 1] >= minGap) {
      result.push(v);
    }
  }
  return result;
}

export async function processVideos(
  jobId: number,
  video1Path: string,
  video2Path: string
): Promise<ProcessResult> {
  const workDir = path.dirname(video1Path);

  try {
    await updateJob(jobId, {
      status: "detecting",
      statusMessage: "🔍 Анализирую видео...",
    });

    const [cutV1At, sceneTimestamps, video2Duration] = await Promise.all([
      findCutPointVideo1(video1Path),
      detectSceneChanges(video2Path),
      getVideoDuration(video2Path),
    ]);

    console.log(`V1 cut point: ${cutV1At}s`);
    console.log(`V2 duration: ${video2Duration}s`);

    await updateJob(jobId, {
      trimPoint: `V1 до ${cutV1At.toFixed(1)}с | V2 целиком`,
      statusMessage: `✂️ Обрезаю V1 и готовлю V2...`,
    });

    // 1) Trim V1 so black screen stays but logo/loading after it is removed
    const trimmed1 = path.join(workDir, "trimmed1.mp4");
    await trimVideoEnd(video1Path, cutV1At, trimmed1);

    // 2) Normalize V2 as-is to create a valid MP4 for merging
    const normalized2 = path.join(workDir, "normalized2.mp4");
    await normalizeVideo(video2Path, normalized2);

    await updateJob(jobId, {
      status: "screenshots",
      statusMessage: "📸 Делаю скриншоты...",
    });

    // Build screenshot timestamps:
    // - detected scene changes (tabs are usually big scene changes)
    // - guaranteed fallback frames for buy phase / later moments
    const fallbackTimes = [
      Math.min(20, Math.max(1, video2Duration * 0.15)),
      Math.min(45, Math.max(5, video2Duration * 0.35)),
      Math.min(90, Math.max(10, video2Duration * 0.65)),
    ].filter((v) => v < video2Duration - 1);

    const screenshotTimes = uniqSortedTimestamps([
      ...sceneTimestamps.slice(0, 8),
      ...fallbackTimes,
    ], 4).slice(0, 8);

    console.log("Screenshot times:", screenshotTimes);

    const screenshotPaths: string[] = [];
    for (let i = 0; i < screenshotTimes.length; i++) {
      const ts = screenshotTimes[i];
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

    await updateJob(jobId, {
      status: "merging",
      statusMessage: "🔗 Склеиваю видео...",
    });

    const mergedPath = path.join(workDir, "merged.mp4");
    await mergeVideos(trimmed1, normalized2, mergedPath);

    await updateJob(jobId, {
      status: "uploading",
      statusMessage: "☁️ Загружаю видео...",
    });

    const gofileResult = await uploadToGoFile(mergedPath);

    await updateJob(jobId, {
      status: "completed",
      statusMessage: "✅ Готово!",
      mergedVideoUrl: gofileResult.downloadPage,
      screenshots: screenshotPaths,
    });

    for (const f of [video1Path, video2Path, trimmed1, normalized2]) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
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
