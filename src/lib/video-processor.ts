import { exec } from "child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);
const FFMPEG_BIN = ffmpegPath ?? "ffmpeg";
const FFPROBE_BIN = ffprobeStatic.path ?? "ffprobe";

function shellQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function ffmpeg(command: string): string {
  return `${shellQuote(FFMPEG_BIN)} ${command}`;
}

function ffprobe(command: string): string {
  return `${shellQuote(FFPROBE_BIN)} ${command}`;
}

/**
 * Get video duration in seconds
 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      ffprobe(
        `-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${shellQuote(videoPath)}`
      ),
      { maxBuffer: 10 * 1024 * 1024 }
    );

    const duration = parseFloat(stdout.trim());
    if (!Number.isFinite(duration)) {
      throw new Error(`Invalid duration output: ${stdout}`);
    }
    return duration;
  } catch (error) {
    console.warn("ffprobe-static failed, trying ffmpeg-static fallback for duration:", error);

    try {
      const fallbackOutput = await execAsync(
        ffmpeg(`-i ${shellQuote(videoPath)}`),
        { maxBuffer: 10 * 1024 * 1024 }
      ).catch((e) => e as { stderr?: string });

      const stderr = typeof fallbackOutput === "object" && "stderr" in fallbackOutput
        ? fallbackOutput.stderr ?? ""
        : "";

      const match = stderr.match(/Duration:\s+(\d+):(\d+):(\d+\.\d+)/);
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseFloat(match[3]);
        return hours * 3600 + minutes * 60 + seconds;
      }
    } catch (fallbackError) {
      console.error("ffmpeg fallback duration detection failed:", fallbackError);
    }

    throw new Error("Could not determine video duration (ffprobe and ffmpeg fallback failed)");
  }
}

/**
 * VIDEO 1: Find where black screen STARTS at the END of the video
 */
export async function findBlackScreenAtEnd(videoPath: string): Promise<number> {
  try {
    const duration = await getVideoDuration(videoPath);
    console.log(`Video 1 duration: ${duration}s`);

    const cmd = ffmpeg(
      `-i ${shellQuote(videoPath)} -vf "blackdetect=d=0.5:pix_th=0.12" -an -f null - 2>&1`
    );
    let output = "";

    try {
      const { stderr } = await execAsync(cmd, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 300000,
      });
      output = stderr;
    } catch (error) {
      const err = error as { stderr?: string };
      if (err.stderr) output = err.stderr;
    }

    const blackStarts: number[] = [];
    const regex = /black_start:(\d+\.?\d*)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(output)) !== null) {
      blackStarts.push(parseFloat(match[1]));
    }

    console.log(`Found ${blackStarts.length} black segments:`, blackStarts);

    if (blackStarts.length === 0) {
      console.log("No black screen found, cutting last 5 seconds");
      return Math.max(0, duration - 5);
    }

    const cutoffTime = Math.max(0, duration - 120);
    let lastBlackStart = blackStarts[blackStarts.length - 1];

    for (let i = blackStarts.length - 1; i >= 0; i--) {
      if (blackStarts[i] >= cutoffTime) {
        lastBlackStart = blackStarts[i];
      }
    }

    console.log(`Cutting video 1 at: ${lastBlackStart}s`);
    return lastBlackStart;
  } catch (error) {
    console.error("Error finding black screen:", error);
    const duration = await getVideoDuration(videoPath);
    return Math.max(0, duration - 5);
  }
}

/**
 * VIDEO 2: Find where the black screen / loading ENDS at the BEGINNING
 */
export async function findGameplayStart(videoPath: string): Promise<number> {
  try {
    const cmd = ffmpeg(
      `-t 120 -i ${shellQuote(videoPath)} -vf "blackdetect=d=0.3:pix_th=0.15" -an -f null - 2>&1`
    );
    let output = "";

    try {
      const { stderr } = await execAsync(cmd, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 180000,
      });
      output = stderr;
    } catch (error) {
      const err = error as { stderr?: string };
      if (err.stderr) output = err.stderr;
    }

    const blackEnds: number[] = [];
    const regex = /black_end:(\d+\.?\d*)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(output)) !== null) {
      blackEnds.push(parseFloat(match[1]));
    }

    console.log(`Video 2 black ends:`, blackEnds);

    if (blackEnds.length === 0) {
      console.log("No black screen in video 2 start, trying scene detection...");
      return await findFirstBigSceneChange(videoPath);
    }

    const lastBlackEnd = blackEnds[blackEnds.length - 1];
    console.log(`Video 2 gameplay starts at: ${lastBlackEnd}s`);
    return lastBlackEnd;
  } catch (error) {
    console.error("Error finding gameplay start:", error);
    return 0;
  }
}

async function findFirstBigSceneChange(videoPath: string): Promise<number> {
  try {
    const cmd = ffmpeg(
      `-t 120 -i ${shellQuote(videoPath)} -vf "select='gt(scene,0.4)',showinfo" -fps_mode vfr -f null - 2>&1`
    );
    let output = "";

    try {
      const { stderr } = await execAsync(cmd, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 180000,
      });
      output = stderr;
    } catch (error) {
      const err = error as { stderr?: string };
      if (err.stderr) output = err.stderr;
    }

    const match = output.match(/pts_time:\s*(\d+\.?\d*)/);
    if (match) {
      const time = parseFloat(match[1]);
      console.log(`First big scene change at: ${time}s`);
      return time;
    }
  } catch (error) {
    console.error("Scene detection error:", error);
  }

  return 0;
}

/**
 * Detect scene changes in video (tab switches on Android + buy phase)
 */
export async function detectSceneChanges(videoPath: string): Promise<number[]> {
  try {
    const cmd = ffmpeg(
      `-i ${shellQuote(videoPath)} -vf "select='gt(scene,0.35)',showinfo" -fps_mode vfr -f null - 2>&1`
    );
    let output = "";

    try {
      const { stderr } = await execAsync(cmd, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 300000,
      });
      output = stderr;
    } catch (error) {
      const err = error as { stderr?: string };
      if (err.stderr) output = err.stderr;
    }

    return parseSceneTimestamps(output);
  } catch (error) {
    console.error("Error detecting scene changes:", error);
    return [];
  }
}

function parseSceneTimestamps(output: string): number[] {
  const timestamps: number[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const match = line.match(/pts_time:\s*(\d+\.?\d*)/);
    if (match) {
      const time = parseFloat(match[1]);
      if (timestamps.length === 0 || time - timestamps[timestamps.length - 1] > 1.5) {
        timestamps.push(time);
      }
    }
  }

  console.log(`Found ${timestamps.length} scene changes:`, timestamps);
  return timestamps;
}

export async function trimVideoEnd(
  inputPath: string,
  endTime: number,
  outputPath: string
): Promise<void> {
  const cmd = ffmpeg(
    `-y -i ${shellQuote(inputPath)} -t ${endTime} -c:v libx264 -preset ultrafast -crf 23 -s 1280x720 -c:a aac -b:a 128k ${shellQuote(outputPath)}`
  );
  console.log(`Trim video end: keep 0 to ${endTime}s`);
  await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 300000 });
}

export async function trimVideoStart(
  inputPath: string,
  startTime: number,
  outputPath: string
): Promise<void> {
  const cmd = ffmpeg(
    `-y -ss ${startTime} -i ${shellQuote(inputPath)} -c:v libx264 -preset ultrafast -crf 23 -s 1280x720 -c:a aac -b:a 128k ${shellQuote(outputPath)}`
  );
  console.log(`Trim video start: keep ${startTime}s to end`);
  await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 300000 });
}

export async function extractFrame(
  videoPath: string,
  timestamp: number,
  outputPath: string
): Promise<void> {
  const cmd = ffmpeg(
    `-y -ss ${timestamp} -i ${shellQuote(videoPath)} -frames:v 1 -q:v 2 ${shellQuote(outputPath)}`
  );
  await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 });
}

export async function mergeVideos(
  video1Path: string,
  video2Path: string,
  outputPath: string
): Promise<void> {
  const dir = path.dirname(outputPath);
  const v1Norm = path.join(dir, "v1_norm.mp4");
  const v2Norm = path.join(dir, "v2_norm.mp4");

  const normCmd = (input: string, output: string) =>
    ffmpeg(
      `-y -i ${shellQuote(input)} -c:v libx264 -preset ultrafast -crf 23 -s 1280x720 -r 30 -c:a aac -b:a 128k -ar 44100 -ac 2 ${shellQuote(output)}`
    );

  console.log("Normalizing videos for seamless merge...");
  await Promise.all([
    execAsync(normCmd(video1Path, v1Norm), { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }),
    execAsync(normCmd(video2Path, v2Norm), { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }),
  ]);

  const listPath = path.join(dir, "concat_list.txt");
  fs.writeFileSync(listPath, `file '${v1Norm}'\nfile '${v2Norm}'`);

  const cmd = ffmpeg(
    `-y -f concat -safe 0 -i ${shellQuote(listPath)} -c copy ${shellQuote(outputPath)}`
  );
  console.log("Merging normalized videos...");
  await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 120000 });

  try { fs.unlinkSync(v1Norm); } catch { /* ignore */ }
  try { fs.unlinkSync(v2Norm); } catch { /* ignore */ }
  try { fs.unlinkSync(listPath); } catch { /* ignore */ }
}
