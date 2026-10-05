import { execFile } from "child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function findBin(fromModule: string | null, searchPaths: string[], fallback: string): string {
  if (fromModule && fs.existsSync(fromModule)) return fromModule;
  for (const p of searchPaths) {
    if (fs.existsSync(p)) return p;
  }
  return fallback;
}

const roots = [process.cwd(), "/ROOT", "/app"];

const FFMPEG = findBin(
  ffmpegPath,
  roots.flatMap((r) => [`${r}/node_modules/ffmpeg-static/ffmpeg`]),
  "ffmpeg"
);

const FFPROBE = findBin(
  ffprobeStatic.path,
  roots.flatMap((r) => [
    `${r}/node_modules/ffprobe-static/bin/linux/x64/ffprobe`,
    `${r}/node_modules/ffprobe-static/bin/linux/ia32/ffprobe`,
  ]),
  "ffprobe"
);

try { fs.chmodSync(FFMPEG, 0o755); } catch { /* ignore */ }
try { fs.chmodSync(FFPROBE, 0o755); } catch { /* ignore */ }

console.log(`[ffmpeg] ${FFMPEG} exists=${fs.existsSync(FFMPEG)}`);
console.log(`[ffprobe] ${FFPROBE} exists=${fs.existsSync(FFPROBE)}`);

async function runFfprobe(args: string[], options?: { timeout?: number; maxBuffer?: number }) {
  return execFileAsync(FFPROBE, args, {
    timeout: options?.timeout ?? 120000,
    maxBuffer: options?.maxBuffer ?? 20 * 1024 * 1024,
  });
}

async function runFfmpeg(args: string[], options?: { timeout?: number; maxBuffer?: number }) {
  return execFileAsync(FFMPEG, args, {
    timeout: options?.timeout ?? 300000,
    maxBuffer: options?.maxBuffer ?? 100 * 1024 * 1024,
  });
}

export async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await runFfprobe([
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);

    const d = parseFloat(stdout.trim());
    if (Number.isFinite(d) && d > 0) return d;
  } catch (error) {
    console.error("ffprobe duration error:", error);
  }

  try {
    await runFfmpeg(["-i", videoPath], { maxBuffer: 20 * 1024 * 1024 });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    const m = stderr.match(/Duration:\s+(\d+):(\d+):(\d+\.\d+)/);
    if (m) {
      return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
    }
  }

  throw new Error(
    `Cannot determine video duration. FFMPEG=${FFMPEG} exists=${fs.existsSync(FFMPEG)} FFPROBE=${FFPROBE} exists=${fs.existsSync(FFPROBE)} video=${videoPath} exists=${fs.existsSync(videoPath)}`
  );
}

export async function hasAudioStream(videoPath: string): Promise<boolean> {
  try {
    const { stdout } = await runFfprobe([
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=index",
      "-of", "csv=p=0",
      videoPath,
    ]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function getBlackSegments(videoPath: string, onlyFirstSeconds?: number): Promise<Array<{ start: number; end: number }>> {
  const args = ["-i", videoPath];
  if (onlyFirstSeconds && onlyFirstSeconds > 0) {
    args.unshift("-t", String(onlyFirstSeconds));
  }

  args.push(
    "-vf", "blackdetect=d=0.5:pix_th=0.12",
    "-an",
    "-f", "null",
    "-"
  );

  let stderr = "";
  try {
    await runFfmpeg(args, { timeout: 300000, maxBuffer: 50 * 1024 * 1024 });
  } catch (error) {
    stderr = (error as { stderr?: string }).stderr ?? "";
  }

  const starts: number[] = [];
  const ends: number[] = [];
  let m: RegExpExecArray | null;
  const startRe = /black_start:(\d+\.?\d*)/g;
  const endRe = /black_end:(\d+\.?\d*)/g;

  while ((m = startRe.exec(stderr)) !== null) starts.push(parseFloat(m[1]));
  while ((m = endRe.exec(stderr)) !== null) ends.push(parseFloat(m[1]));

  const segments: Array<{ start: number; end: number }> = [];
  const fallbackEnd = await getVideoDuration(videoPath);
  for (let i = 0; i < starts.length; i++) {
    segments.push({ start: starts[i], end: ends[i] ?? fallbackEnd });
  }

  return segments;
}

// V1: keep content + black bridge, cut logo/loading after black bridge
export async function findCutPointVideo1(videoPath: string): Promise<number> {
  const duration = await getVideoDuration(videoPath);
  const segments = await getBlackSegments(videoPath);
  console.log("V1 black segments:", segments);

  if (segments.length === 0) return duration;

  const cutoff = Math.max(0, duration - 120);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].start >= cutoff) {
      return segments[i].end;
    }
  }

  return segments[segments.length - 1].end;
}

// V2: user wants to keep black screen at start as bridge, so no trim
export async function findCutPointVideo2(): Promise<number> {
  return 0;
}

export async function detectSceneChanges(videoPath: string): Promise<number[]> {
  let stderr = "";
  try {
    await runFfmpeg([
      "-i", videoPath,
      "-vf", "select='gt(scene,0.22)',showinfo",
      "-fps_mode", "vfr",
      "-f", "null",
      "-",
    ], { timeout: 300000, maxBuffer: 50 * 1024 * 1024 });
  } catch (error) {
    stderr = (error as { stderr?: string }).stderr ?? "";
  }

  const timestamps: number[] = [];
  for (const line of stderr.split("\n")) {
    const m = line.match(/pts_time:\s*(\d+\.?\d*)/);
    if (m) {
      const t = parseFloat(m[1]);
      if (timestamps.length === 0 || t - timestamps[timestamps.length - 1] > 4) {
        timestamps.push(t);
      }
    }
  }

  console.log(`Scene changes found: ${timestamps.length}`, timestamps.slice(0, 12));
  return timestamps;
}

// Reliable trim: always re-encode, keep original resolution, valid MP4
export async function trimVideoEnd(input: string, endTime: number, output: string): Promise<void> {
  const hasAudio = await hasAudioStream(input);
  const args = [
    "-y",
    "-i", input,
    "-t", String(endTime),
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
  ];

  if (hasAudio) {
    args.push("-c:a", "aac", "-b:a", "128k");
  } else {
    args.push("-an");
  }

  args.push("-movflags", "+faststart", output);

  await runFfmpeg(args, { timeout: 300000, maxBuffer: 100 * 1024 * 1024 });
}

export async function normalizeVideo(input: string, output: string): Promise<void> {
  const hasAudio = await hasAudioStream(input);
  const args = [
    "-y",
    "-i", input,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
  ];

  if (hasAudio) {
    args.push("-c:a", "aac", "-b:a", "128k");
  } else {
    args.push("-an");
  }

  args.push("-movflags", "+faststart", output);

  await runFfmpeg(args, { timeout: 600000, maxBuffer: 100 * 1024 * 1024 });
}

export async function extractFrame(videoPath: string, timestamp: number, outputPath: string): Promise<void> {
  await runFfmpeg([
    "-y",
    "-ss", String(timestamp),
    "-i", videoPath,
    "-frames:v", "1",
    "-q:v", "2",
    outputPath,
  ], { timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
}

// Merge normalized videos reliably
export async function mergeVideos(v1: string, v2: string, output: string): Promise<void> {
  const v1Audio = await hasAudioStream(v1);
  const v2Audio = await hasAudioStream(v2);

  if (v1Audio && v2Audio) {
    await runFfmpeg([
      "-y",
      "-i", v1,
      "-i", v2,
      "-filter_complex", "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[ov][oa]",
      "-map", "[ov]",
      "-map", "[oa]",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      output,
    ], { timeout: 900000, maxBuffer: 150 * 1024 * 1024 });
  } else {
    await runFfmpeg([
      "-y",
      "-i", v1,
      "-i", v2,
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[ov]",
      "-map", "[ov]",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-an",
      "-movflags", "+faststart",
      output,
    ], { timeout: 900000, maxBuffer: 150 * 1024 * 1024 });
  }
}
