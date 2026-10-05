import { exec } from "child_process";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

// Use bundled binaries — no system ffmpeg/ffprobe needed
// Resolve absolute path to handle cases where the module returns null
function resolveBin(bin: string | null, fallback: string): string {
  if (bin && bin.length > 0) return bin;
  // Try common locations
  const candidates = [
    `${process.cwd()}/node_modules/ffmpeg-static/ffmpeg`,
    `${process.cwd()}/node_modules/ffprobe-static/bin/linux/x64/ffprobe`,
    fallback,
  ];
  for (const c of candidates) {
    try {
      if (require("fs").existsSync(c)) return c;
    } catch { /* */ }
  }
  return fallback;
}

const FFMPEG  = resolveBin(ffmpegPath,        "ffmpeg");
const FFPROBE = resolveBin(ffprobeStatic.path, "ffprobe");

// Ensure execute permissions
try {
  require("fs").chmodSync(FFMPEG,  0o755);
  require("fs").chmodSync(FFPROBE, 0o755);
} catch { /* might fail if system binary, that's ok */ }

console.log(`[video-processor] FFMPEG:  ${FFMPEG}`);
console.log(`[video-processor] FFPROBE: ${FFPROBE}`);

function q(s: string) { return `"${s.replace(/"/g, '\\"')}"`; }
const ff  = (a: string) => `${q(FFMPEG)}  ${a}`;
const fpp = (a: string) => `${q(FFPROBE)} ${a}`;

// ─── duration ─────────────────────────────────────────────

export async function getVideoDuration(videoPath: string): Promise<number> {
  // Try ffprobe first
  try {
    const { stdout } = await execAsync(
      fpp(`-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${q(videoPath)}`),
      { maxBuffer: 10 * 1024 * 1024 }
    );
    const d = parseFloat(stdout.trim());
    if (Number.isFinite(d) && d > 0) return d;
  } catch { /* fall through */ }

  // Fallback: parse ffmpeg -i stderr
  try {
    const result = await execAsync(ff(`-i ${q(videoPath)}`), { maxBuffer: 10 * 1024 * 1024 }).catch(e => e as { stderr?: string });
    const stderr = (result as { stderr?: string }).stderr ?? "";
    const m = stderr.match(/Duration:\s+(\d+):(\d+):(\d+\.\d+)/);
    if (m) return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  } catch { /* ignore */ }

  throw new Error(`Cannot determine video duration. FFMPEG=${FFMPEG}, FFPROBE=${FFPROBE}, file=${videoPath}, exists=${require("fs").existsSync(videoPath)}`);
}

// ─── VIDEO 1: last black screen start (end of recording) ──

export async function findBlackScreenAtEnd(videoPath: string): Promise<number> {
  const duration = await getVideoDuration(videoPath);
  console.log(`V1 duration: ${duration.toFixed(1)}s`);

  let output = "";
  try {
    await execAsync(
      ff(`-i ${q(videoPath)} -vf "blackdetect=d=0.5:pix_th=0.12" -an -f null -`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
    );
  } catch (e) { output = (e as { stderr?: string }).stderr ?? ""; }

  const starts: number[] = [];
  let m: RegExpExecArray | null;
  const re = /black_start:(\d+\.?\d*)/g;
  while ((m = re.exec(output)) !== null) starts.push(parseFloat(m[1]));
  console.log(`V1 black starts: ${starts.length}`, starts.slice(-5));

  if (starts.length === 0) return Math.max(0, duration - 3);

  const cutoff = Math.max(0, duration - 120);
  for (let i = starts.length - 1; i >= 0; i--) {
    if (starts[i] >= cutoff) return starts[i];
  }
  return starts[starts.length - 1];
}

// ─── VIDEO 2: first black screen end (start of game) ──────

export async function findGameplayStart(videoPath: string): Promise<number> {
  let output = "";
  try {
    await execAsync(
      ff(`-t 120 -i ${q(videoPath)} -vf "blackdetect=d=0.3:pix_th=0.15" -an -f null -`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 180000 }
    );
  } catch (e) { output = (e as { stderr?: string }).stderr ?? ""; }

  const ends: number[] = [];
  let m: RegExpExecArray | null;
  const re = /black_end:(\d+\.?\d*)/g;
  while ((m = re.exec(output)) !== null) ends.push(parseFloat(m[1]));
  console.log(`V2 black ends:`, ends);

  if (ends.length > 0) return ends[ends.length - 1];

  // Fallback: first scene change
  let sceneOut = "";
  try {
    await execAsync(
      ff(`-t 120 -i ${q(videoPath)} -vf "select='gt(scene,0.4)',showinfo" -fps_mode vfr -f null -`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 180000 }
    );
  } catch (e) { sceneOut = (e as { stderr?: string }).stderr ?? ""; }

  const sm = sceneOut.match(/pts_time:\s*(\d+\.?\d*)/);
  if (sm) return parseFloat(sm[1]);
  return 0;
}

// ─── scene changes (tab switches + buy phase) ─────────────

export async function detectSceneChanges(videoPath: string): Promise<number[]> {
  let output = "";
  try {
    await execAsync(
      ff(`-i ${q(videoPath)} -vf "select='gt(scene,0.35)',showinfo" -fps_mode vfr -f null -`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
    );
  } catch (e) { output = (e as { stderr?: string }).stderr ?? ""; }

  const timestamps: number[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(/pts_time:\s*(\d+\.?\d*)/);
    if (m) {
      const t = parseFloat(m[1]);
      if (timestamps.length === 0 || t - timestamps[timestamps.length - 1] > 1.5) {
        timestamps.push(t);
      }
    }
  }
  console.log(`Scene changes: ${timestamps.length}`);
  return timestamps;
}

// ─── trim — stream copy, no re-encode, original quality ───

export async function trimVideoEnd(input: string, endTime: number, output: string): Promise<void> {
  try {
    // Stream copy (instant, no quality loss)
    await execAsync(
      ff(`-y -i ${q(input)} -t ${endTime} -c copy ${q(output)}`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
    );
  } catch {
    // Fallback: re-encode without -s (keep original resolution)
    await execAsync(
      ff(`-y -i ${q(input)} -t ${endTime} -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 128k ${q(output)}`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
    );
  }
  console.log(`V1 trimmed: 0→${endTime}s`);
}

export async function trimVideoStart(input: string, startTime: number, output: string): Promise<void> {
  try {
    // Stream copy
    await execAsync(
      ff(`-y -ss ${startTime} -i ${q(input)} -c copy ${q(output)}`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
    );
  } catch {
    // Fallback
    await execAsync(
      ff(`-y -ss ${startTime} -i ${q(input)} -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 128k ${q(output)}`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
    );
  }
  console.log(`V2 trimmed: ${startTime}s→end`);
}

// ─── extract screenshot ────────────────────────────────────

export async function extractFrame(videoPath: string, timestamp: number, outputPath: string): Promise<void> {
  await execAsync(
    ff(`-y -ss ${timestamp} -i ${q(videoPath)} -frames:v 1 -q:v 2 ${q(outputPath)}`),
    { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
  );
}

// ─── merge ────────────────────────────────────────────────

export async function mergeVideos(v1: string, v2: string, output: string): Promise<void> {
  const dir = path.dirname(output);
  const listPath = path.join(dir, "concat.txt");
  fs.writeFileSync(listPath, `file '${v1}'\nfile '${v2}'`);

  try {
    // Fast concat (stream copy, no quality loss, keeps original resolution)
    await execAsync(
      ff(`-y -f concat -safe 0 -i ${q(listPath)} -c copy ${q(output)}`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 120000 }
    );
    console.log("Merge: stream copy OK");
  } catch {
    // Fallback: re-encode (NO -s flag — keep original resolution)
    console.log("Merge: falling back to re-encode...");
    await execAsync(
      ff(`-y -i ${q(v1)} -i ${q(v2)} -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[ov][oa]" -map "[ov]" -map "[oa]" -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 128k ${q(output)}`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 600000 }
    );
    console.log("Merge: re-encode OK");
  }

  try { fs.unlinkSync(listPath); } catch { /* ignore */ }
}
