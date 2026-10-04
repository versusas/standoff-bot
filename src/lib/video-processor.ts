import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

/**
 * Detect end of black screen in video (finds where the game logo appears)
 */
export async function detectBlackScreenEnd(videoPath: string): Promise<number> {
  try {
    const { stderr } = await execAsync(
      `ffmpeg -i "${videoPath}" -vf "blackdetect=d=0.3:pix_th=0.15" -an -f null - 2>&1`,
      { maxBuffer: 50 * 1024 * 1024 }
    );

    const matches = stderr.match(/black_end:(\d+\.?\d*)/g);
    if (!matches || matches.length === 0) {
      console.log("No black screen detected, starting from beginning");
      return 0;
    }

    // Get the last black_end before content starts
    let lastBlackEnd = 0;
    for (const match of matches) {
      const time = parseFloat(match.replace("black_end:", ""));
      // We want the black screen at the beginning of the video
      // Stop looking if we're past 2 minutes (120 seconds)
      if (time < 120) {
        lastBlackEnd = time;
      }
    }

    console.log(`Black screen ends at: ${lastBlackEnd}s`);
    return lastBlackEnd;
  } catch (error) {
    // ffmpeg outputs to stderr even on success
    const err = error as { stderr?: string };
    if (err.stderr) {
      const matches = err.stderr.match(/black_end:(\d+\.?\d*)/g);
      if (matches && matches.length > 0) {
        let lastBlackEnd = 0;
        for (const match of matches) {
          const time = parseFloat(match.replace("black_end:", ""));
          if (time < 120) {
            lastBlackEnd = time;
          }
        }
        console.log(`Black screen ends at: ${lastBlackEnd}s`);
        return lastBlackEnd;
      }
    }
    console.error("Error detecting black screen:", error);
    return 0;
  }
}

/**
 * Trim video from specified start time
 */
export async function trimVideo(
  inputPath: string,
  startTime: number,
  outputPath: string
): Promise<void> {
  // Use -ss before -i for fast seeking, then re-encode for precise cut
  const cmd = `ffmpeg -y -ss ${startTime} -i "${inputPath}" -c:v libx264 -preset ultrafast -crf 23 -s 1280x720 -c:a aac -b:a 128k "${outputPath}"`;
  console.log(`Trimming video: ${cmd}`);
  await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 180000 });
}

/**
 * Detect scene changes in video (tab switches on Android)
 * Returns timestamps where significant visual changes occur
 */
export async function detectSceneChanges(videoPath: string): Promise<number[]> {
  try {
    const cmd = `ffmpeg -i "${videoPath}" -vf "select='gt(scene,0.35)',showinfo" -vsync vfr -f null - 2>&1`;
    const { stderr } = await execAsync(cmd, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 300000,
    });

    return parseSceneTimestamps(stderr);
  } catch (error) {
    const err = error as { stderr?: string };
    if (err.stderr) {
      return parseSceneTimestamps(err.stderr);
    }
    console.error("Error detecting scene changes:", error);
    return [];
  }
}

function parseSceneTimestamps(output: string): number[] {
  const timestamps: number[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    // Parse showinfo output: pts_time:XX.XXXX
    const match = line.match(/pts_time:\s*(\d+\.?\d*)/);
    if (match) {
      const time = parseFloat(match[1]);
      // Filter out timestamps that are too close together (within 1 second)
      if (
        timestamps.length === 0 ||
        time - timestamps[timestamps.length - 1] > 1.0
      ) {
        timestamps.push(time);
      }
    }
  }

  console.log(`Found ${timestamps.length} scene changes:`, timestamps);
  return timestamps;
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
 * Merge two videos into one
 */
export async function mergeVideos(
  video1Path: string,
  video2Path: string,
  outputPath: string
): Promise<void> {
  // First try concat demuxer (fast, no re-encoding)
  const listPath = path.join(path.dirname(outputPath), "concat_list.txt");
  const listContent = `file '${video1Path}'\nfile '${video2Path}'`;
  fs.writeFileSync(listPath, listContent);

  try {
    // Try fast concat (no re-encoding)
    const cmd = `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`;
    console.log(`Merging videos (fast): ${cmd}`);
    await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 60000 });
    console.log("Fast merge successful");
  } catch {
    console.log("Fast merge failed, falling back to re-encoding...");
    // Fallback: re-encode both videos with matching parameters
    const cmd = `ffmpeg -y -i "${video1Path}" -i "${video2Path}" -filter_complex "[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[outv][outa]" -map "[outv]" -map "[outa]" -preset ultrafast -crf 23 -s 1280x720 -c:a aac -b:a 128k "${outputPath}"`;
    console.log(`Merging videos (re-encode): ${cmd}`);
    await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 300000 });
  }

  // Cleanup
  try {
    fs.unlinkSync(listPath);
  } catch {
    /* ignore */
  }
}

/**
 * Get video duration in seconds
 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
    { maxBuffer: 10 * 1024 * 1024 }
  );
  return parseFloat(stdout.trim());
}
