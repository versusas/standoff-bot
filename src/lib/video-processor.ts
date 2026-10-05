import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

/**
 * Get video duration in seconds
 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
    return parseFloat(stdout.trim());
  } catch (error) {
    console.warn("ffprobe failed, trying ffmpeg fallback for duration:", error);
    // Fallback using ffmpeg output if ffprobe is missing
    const { stderr } = await execAsync(`ffmpeg -i "${videoPath}" 2>&1`).catch(e => e);
    const match = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    if (match) {
      const hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const seconds = parseFloat(match[3]);
      return hours * 3600 + minutes * 60 + seconds;
    }
    throw new Error("Could not determine video duration (ffprobe and ffmpeg failed)");
  }
}

/**
 * VIDEO 1: Find where black screen STARTS at the END of the video
 * (user opens the game → black loading screen appears → we cut HERE)
 * 
 * Returns the timestamp where we should END video 1
 */
export async function findBlackScreenAtEnd(videoPath: string): Promise<number> {
  try {
    const duration = await getVideoDuration(videoPath);
    console.log(`Video 1 duration: ${duration}s`);

    // Run blackdetect on the video
    const cmd = `ffmpeg -i "${videoPath}" -vf "blackdetect=d=0.5:pix_th=0.12" -an -f null - 2>&1`;
    let output = "";

    try {
      const { stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 300000 });
      output = stderr;
    } catch (error) {
      const err = error as { stderr?: string };
      if (err.stderr) output = err.stderr;
    }

    // Find all black screen segments
    const blackStarts: number[] = [];
    const regex = /black_start:(\d+\.?\d*)/g;
    let match;
    while ((match = regex.exec(output)) !== null) {
      blackStarts.push(parseFloat(match[1]));
    }

    console.log(`Found ${blackStarts.length} black segments:`, blackStarts);

    if (blackStarts.length === 0) {
      // No black screen found — use last 5 seconds as fallback
      console.log("No black screen found, cutting last 5 seconds");
      return Math.max(0, duration - 5);
    }

    // We want the LAST black screen (the game loading screen at the end)
    // Find the last black_start that is in the last 2 minutes of the video
    const cutoffTime = Math.max(0, duration - 120);
    let lastBlackStart = blackStarts[blackStarts.length - 1];

    for (let i = blackStarts.length - 1; i >= 0; i--) {
      if (blackStarts[i] >= cutoffTime) {
        lastBlackStart = blackStarts[i];
      }
    }

    console.log(`Cutting video 1 at: ${lastBlackStart}s (black screen start at end)`);
    return lastBlackStart;
  } catch (error) {
    console.error("Error finding black screen:", error);
    const duration = await getVideoDuration(videoPath);
    return Math.max(0, duration - 5);
  }
}

/**
 * VIDEO 2: Find where the black screen / loading ENDS at the BEGINNING
 * (game loads → logo → gameplay starts → we start HERE)
 * 
 * Returns the timestamp where video 2 should START
 */
export async function findGameplayStart(videoPath: string): Promise<number> {
  try {
    // Run blackdetect on first 2 minutes of the video
    const cmd = `ffmpeg -t 120 -i "${videoPath}" -vf "blackdetect=d=0.3:pix_th=0.15" -an -f null - 2>&1`;
    let output = "";

    try {
      const { stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 180000 });
      output = stderr;
    } catch (error) {
      const err = error as { stderr?: string };
      if (err.stderr) output = err.stderr;
    }

    // Find all black_end timestamps
    const blackEnds: number[] = [];
    const regex = /black_end:(\d+\.?\d*)/g;
    let match;
    while ((match = regex.exec(output)) !== null) {
      blackEnds.push(parseFloat(match[1]));
    }

    console.log(`Video 2 black ends:`, blackEnds);

    if (blackEnds.length === 0) {
      // No black screen — might start with logo, use scene detection
      console.log("No black screen in video 2 start, trying scene detection...");
      return await findFirstBigSceneChange(videoPath);
    }

    // The last black_end in the first 2 minutes = where gameplay starts
    const lastBlackEnd = blackEnds[blackEnds.length - 1];
    console.log(`Video 2 gameplay starts at: ${lastBlackEnd}s`);
    return lastBlackEnd;
  } catch (error) {
    console.error("Error finding gameplay start:", error);
    return 0;
  }
}

/**
 * Find the first big scene change (loading screen → gameplay transition)
 */
async function findFirstBigSceneChange(videoPath: string): Promise<number> {
  try {
    const cmd = `ffmpeg -t 120 -i "${videoPath}" -vf "select='gt(scene,0.4)',showinfo" -vsync vfr -f null - 2>&1`;
    let output = "";

    try {
      const { stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 180000 });
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
 * Returns timestamps where significant visual changes occur
 */
export async function detectSceneChanges(videoPath: string): Promise<number[]> {
  try {
    const cmd = `ffmpeg -i "${videoPath}" -vf "select='gt(scene,0.35)',showinfo" -vsync vfr -f null - 2>&1`;
    let output = "";

    try {
      const { stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 300000 });
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
      // Filter timestamps too close together (within 1.5 seconds)
      if (timestamps.length === 0 || time - timestamps[timestamps.length - 1] > 1.5) {
        timestamps.push(time);
      }
    }
  }

  console.log(`Found ${timestamps.length} scene changes:`, timestamps);
  return timestamps;
}

/**
 * Trim video: keep from start to endTime
 */
export async function trimVideoEnd(
  inputPath: string,
  endTime: number,
  outputPath: string
): Promise<void> {
  const cmd = `ffmpeg -y -i "${inputPath}" -t ${endTime} -c:v libx264 -preset ultrafast -crf 23 -s 1280x720 -c:a aac -b:a 128k "${outputPath}"`;
  console.log(`Trim video end: keep 0 to ${endTime}s`);
  await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 300000 });
}

/**
 * Trim video: keep from startTime to end
 */
export async function trimVideoStart(
  inputPath: string,
  startTime: number,
  outputPath: string
): Promise<void> {
  const cmd = `ffmpeg -y -ss ${startTime} -i "${inputPath}" -c:v libx264 -preset ultrafast -crf 23 -s 1280x720 -c:a aac -b:a 128k "${outputPath}"`;
  console.log(`Trim video start: keep ${startTime}s to end`);
  await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 300000 });
}

/**
 * Extract a frame from video at specific timestamp
 */
export async function extractFrame(
  videoPath: string,
  timestamp: number,
  outputPath: string
): Promise<void> {
  const cmd = `ffmpeg -y -ss ${timestamp} -i "${videoPath}" -frames:v 1 -q:v 2 "${outputPath}"`;
  await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 });
}

/**
 * Merge two videos into one seamlessly
 */
export async function mergeVideos(
  video1Path: string,
  video2Path: string,
  outputPath: string
): Promise<void> {
  // Re-encode both with identical parameters so the concat is seamless
  const dir = path.dirname(outputPath);
  const v1Norm = path.join(dir, "v1_norm.mp4");
  const v2Norm = path.join(dir, "v2_norm.mp4");

  // Normalize both videos to same format
  const normCmd = (input: string, output: string) =>
    `ffmpeg -y -i "${input}" -c:v libx264 -preset ultrafast -crf 23 -s 1280x720 -r 30 -c:a aac -b:a 128k -ar 44100 -ac 2 "${output}"`;

  console.log("Normalizing videos for seamless merge...");
  await Promise.all([
    execAsync(normCmd(video1Path, v1Norm), { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }),
    execAsync(normCmd(video2Path, v2Norm), { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }),
  ]);

  // Concat with demuxer
  const listPath = path.join(dir, "concat_list.txt");
  fs.writeFileSync(listPath, `file '${v1Norm}'\nfile '${v2Norm}'`);

  const cmd = `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`;
  console.log("Merging normalized videos...");
  await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 120000 });

  // Cleanup
  try { fs.unlinkSync(v1Norm); } catch { /* */ }
  try { fs.unlinkSync(v2Norm); } catch { /* */ }
  try { fs.unlinkSync(listPath); } catch { /* */ }
}
