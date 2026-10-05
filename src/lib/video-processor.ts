import { exec } from "child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);
const FFMPEG = ffmpegPath ?? "ffmpeg";
const FFPROBE = ffprobeStatic.path ?? "ffprobe";

function q(v: string): string {
  return `"${v.replace(/"/g, '\\"')}"`;
}

function ff(args: string): string {
  return `${q(FFMPEG)} ${args}`;
}

function fp(args: string): string {
  return `${q(FFPROBE)} ${args}`;
}

// ─── helpers ───

export async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      fp(`-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${q(videoPath)}`),
      { maxBuffer: 10 * 1024 * 1024 }
    );
    const d = parseFloat(stdout.trim());
    if (Number.isFinite(d)) return d;
  } catch { /* fall through */ }

  // fallback
  try {
    const res = await execAsync(ff(`-i ${q(videoPath)}`), { maxBuffer: 10 * 1024 * 1024 }).catch((e) => e as { stderr?: string });
    const stderr = typeof res === "object" && "stderr" in res ? (res.stderr ?? "") : "";
    const m = stderr.match(/Duration:\s+(\d+):(\d+):(\d+\.\d+)/);
    if (m) return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  } catch { /* ignore */ }

  throw new Error("Cannot determine video duration");
}

// ─── VIDEO 1: find black screen at END ───

export async function findBlackScreenAtEnd(videoPath: string): Promise<number> {
  const duration = await getVideoDuration(videoPath);
  console.log(`V1 duration: ${duration}s`);

  let output = "";
  try {
    await execAsync(
      ff(`-i ${q(videoPath)} -vf "blackdetect=d=0.5:pix_th=0.12" -an -f null -`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
    );
  } catch (e) {
    const err = e as { stderr?: string };
    output = err.stderr ?? "";
  }

  const starts: number[] = [];
  let m: RegExpExecArray | null;
  const re = /black_start:(\d+\.?\d*)/g;
  while ((m = re.exec(output)) !== null) starts.push(parseFloat(m[1]));

  console.log(`V1 black segments: ${starts.length}`, starts.slice(-5));

  if (starts.length === 0) return Math.max(0, duration - 3);

  // last black_start in last 2 min
  const cutoff = Math.max(0, duration - 120);
  for (let i = starts.length - 1; i >= 0; i--) {
    if (starts[i] >= cutoff) return starts[i];
  }
  return starts[starts.length - 1];
}

// ─── VIDEO 2: find black screen at START ───

export async function findGameplayStart(videoPath: string): Promise<number> {
  let output = "";
  try {
    await execAsync(
      ff(`-t 120 -i ${q(videoPath)} -vf "blackdetect=d=0.3:pix_th=0.15" -an -f null -`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 180000 }
    );
  } catch (e) {
    const err = e as { stderr?: string };
    output = err.stderr ?? "";
  }

  const ends: number[] = [];
  let m: RegExpExecArray | null;
  const re = /black_end:(\d+\.?\d*)/g;
  while ((m = re.exec(output)) !== null) ends.push(parseFloat(m[1]));

  console.log(`V2 black ends:`, ends);

  if (ends.length > 0) {
    const last = ends[ends.length - 1];
    console.log(`V2 gameplay starts at: ${last}s`);
    return last;
  }

  // fallback: first big scene change
  try {
    let sceneOut = "";
    try {
      await execAsync(
        ff(`-t 120 -i ${q(videoPath)} -vf "select='gt(scene,0.4)',showinfo" -fps_mode vfr -f null -`),
        { maxBuffer: 50 * 1024 * 1024, timeout: 180000 }
      );
    } catch (e) {
      const err = e as { stderr?: string };
      sceneOut = err.stderr ?? "";
    }
    const sm = sceneOut.match(/pts_time:\s*(\d+\.?\d*)/);
    if (sm) return parseFloat(sm[1]);
  } catch { /* ignore */ }

  return 0;
}

// ─── scene changes (tab switches + buy phase) ───

export async function detectSceneChanges(videoPath: string): Promise<number[]> {
  let output = "";
  try {
    await execAsync(
      ff(`-i ${q(videoPath)} -vf "select='gt(scene,0.35)',showinfo" -fps_mode vfr -f null -`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
    );
  } catch (e) {
    const err = e as { stderr?: string };
    output = err.stderr ?? "";
  }

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
  console.log(`Scene changes: ${timestamps.length}`, timestamps.slice(0, 10));
  return timestamps;
}

// ─── trim / cut — NO resolution change, keep original ───

export async function trimVideoEnd(input: string, endTime: number, output: string): Promise<void> {
  // Copy streams up to endTime — no re-encode, original quality
  const cmd = ff(`-y -i ${q(input)} -t ${endTime} -c copy ${q(output)}`);
  console.log(`Trim V1: keep 0→${endTime}s`);
  await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 300000 });
}

export async function trimVideoStart(input: string, startTime: number, output: string): Promise<void> {
  // Copy streams from startTime — no re-encode, original quality
  const cmd = ff(`-y -ss ${startTime} -i ${q(input)} -c copy ${q(output)}`);
  console.log(`Trim V2: keep ${startTime}s→end`);
  await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 300000 });
}

// ─── extract screenshot ───

export async function extractFrame(videoPath: string, timestamp: number, outputPath: string): Promise<void> {
  const cmd = ff(`-y -ss ${timestamp} -i ${q(videoPath)} -frames:v 1 -q:v 2 ${q(outputPath)}`);
  await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 });
}

// ─── merge two videos seamlessly ───

export async function mergeVideos(v1: string, v2: string, output: string): Promise<void> {
  const dir = path.dirname(output);

  // Try fast concat (stream copy, no re-encode) first
  const listPath = path.join(dir, "concat.txt");
  fs.writeFileSync(listPath, `file '${v1}'\nfile '${v2}'`);

  try {
    const cmd = ff(`-y -f concat -safe 0 -i ${q(listPath)} -c copy ${q(output)}`);
    console.log("Merge: trying stream copy concat...");
    await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 120000 });
    console.log("Merge: stream copy OK");
  } catch {
    // Fallback: re-encode with ORIGINAL resolution (no -s flag!)
    console.log("Merge: stream copy failed, re-encoding...");
    const cmd = ff(
      `-y -i ${q(v1)} -i ${q(v2)} -filter_complex "[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[outv][outa]" -map "[outv]" -map "[outa]" -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 128k ${q(output)}`
    );
    await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 600000 });
    console.log("Merge: re-encode OK");
  }

  try { fs.unlinkSync(listPath); } catch { /* */ }
}
