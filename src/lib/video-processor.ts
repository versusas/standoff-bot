import { exec } from "child_process";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

// Resolve ffmpeg/ffprobe — search multiple locations for Railway
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
  roots.flatMap(r => [`${r}/node_modules/ffmpeg-static/ffmpeg`]),
  "ffmpeg"
);

const FFPROBE = findBin(
  ffprobeStatic.path,
  roots.flatMap(r => [
    `${r}/node_modules/ffprobe-static/bin/linux/x64/ffprobe`,
    `${r}/node_modules/ffprobe-static/bin/linux/ia32/ffprobe`,
  ]),
  "ffprobe"
);

try { fs.chmodSync(FFMPEG,  0o755); } catch { /* ok */ }
try { fs.chmodSync(FFPROBE, 0o755); } catch { /* ok */ }

console.log(`[ffmpeg]  ${FFMPEG}  exists=${fs.existsSync(FFMPEG)}`);
console.log(`[ffprobe] ${FFPROBE}  exists=${fs.existsSync(FFPROBE)}`);

function q(s: string) { return `"${s.replace(/"/g, '\\"')}"`; }
const ff  = (a: string) => `${q(FFMPEG)}  ${a}`;
const fpp = (a: string) => `${q(FFPROBE)} ${a}`;

// ─── duration ─────────────────────────────────────────────

export async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      fpp(`-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${q(videoPath)}`),
      { maxBuffer: 10 * 1024 * 1024 }
    );
    const d = parseFloat(stdout.trim());
    if (Number.isFinite(d) && d > 0) return d;
  } catch { /* fall through */ }

  try {
    const result = await execAsync(ff(`-i ${q(videoPath)}`), { maxBuffer: 10 * 1024 * 1024 }).catch(e => e as { stderr?: string });
    const stderr = (result as { stderr?: string }).stderr ?? "";
    const m = stderr.match(/Duration:\s+(\d+):(\d+):(\d+\.\d+)/);
    if (m) return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  } catch { /* ignore */ }

  throw new Error(`Cannot determine video duration. FFMPEG=${FFMPEG}, FFPROBE=${FFPROBE}, file=${videoPath}, exists=${fs.existsSync(videoPath)}`);
}

// ─── VIDEO 1: Find where to cut ───────────────────────────
// V1 ends with: [settings stuff] → [open game] → [BLACK SCREEN] → [logo/loading]
// We want to KEEP the black screen but CUT the logo/loading after it
// So we find the FIRST black_end after the last black_start in the last 2 min
// and cut at that black_end (keeping the black, removing logo)

export async function findCutPointVideo1(videoPath: string): Promise<number> {
  const duration = await getVideoDuration(videoPath);
  console.log(`V1 duration: ${duration.toFixed(1)}s`);

  let output = "";
  try {
    await execAsync(
      ff(`-i ${q(videoPath)} -vf "blackdetect=d=0.5:pix_th=0.12" -an -f null -`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
    );
  } catch (e) { output = (e as { stderr?: string }).stderr ?? ""; }

  // Parse all black segments
  const segments: { start: number; end: number }[] = [];
  const reStart = /black_start:(\d+\.?\d*)/g;
  const reEnd = /black_end:(\d+\.?\d*)/g;
  const starts: number[] = [];
  const ends: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = reStart.exec(output)) !== null) starts.push(parseFloat(m[1]));
  while ((m = reEnd.exec(output)) !== null) ends.push(parseFloat(m[1]));

  for (let i = 0; i < starts.length; i++) {
    segments.push({ start: starts[i], end: ends[i] ?? duration });
  }
  console.log(`V1 black segments:`, segments.slice(-5));

  if (segments.length === 0) {
    // No black screen found — keep everything
    return duration;
  }

  // Find the last significant black segment in the last 2 minutes
  const cutoff = Math.max(0, duration - 120);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].start >= cutoff) {
      // Keep up to the END of this black segment (black screen is the "bridge")
      const cutAt = segments[i].end;
      console.log(`V1: keeping 0→${cutAt.toFixed(1)}s (black screen included, logo cut)`);
      return cutAt;
    }
  }

  // Fallback: use the last segment
  const last = segments[segments.length - 1];
  console.log(`V1: keeping 0→${last.end.toFixed(1)}s`);
  return last.end;
}

// ─── VIDEO 2: Find where to cut ──────────────────────────
// V2 starts with: [BLACK SCREEN] → [logo/loading] → [menu/lobby] → [gameplay]
// We want to KEEP the black screen at the start but cut the logo/loading
// The logo appears AFTER the first black screen ends
// Then another black/transition happens before gameplay
// Strategy: find the LAST black_end in the first 2 minutes → that's where gameplay starts
// But we keep everything from the START (including initial black screen)
// Actually: V2 starts recording at black screen. We keep it all, just need to find
// where the LOADING ends so we can know where gameplay begins.
//
// Wait - re-reading: "черный экран — это мост". So:
// V1 ends with black screen. V2 starts with black screen.
// When merged: V1_content → black → black → V2_content
// The black screens from both overlap/blend naturally.
//
// So for V2: we DON'T cut the beginning at all! We keep the black screen.
// But we might want to cut the LOGO/LOADING that comes after black.
// Actually NO — the user said "второй рек должен с него начинаться" (second rec starts from it)
// Meaning: keep the black screen, keep everything. No trimming of V2 beginning.
// The only thing to cut from V2 is... nothing at the start.
//
// Let me re-read: the first video shows settings, opens game, black screen appears.
// The first rec ENDS here (stopped recording on black screen).
// The second rec STARTS from the black screen (started new recording).
// So the only overlap is: both have the same black loading screen.
//
// For seamless merge: just concat them. The black screens will naturally bridge.
// No need to detect anything on V2 start.

export async function findCutPointVideo2(): Promise<number> {
  // Keep everything from the start — black screen is the bridge
  console.log(`V2: keeping from 0s (black screen bridge preserved)`);
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

// ─── trim — keep original quality ─────────────────────────

export async function trimVideoEnd(input: string, endTime: number, output: string): Promise<void> {
  try {
    await execAsync(
      ff(`-y -i ${q(input)} -t ${endTime} -c copy ${q(output)}`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
    );
  } catch {
    await execAsync(
      ff(`-y -i ${q(input)} -t ${endTime} -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 128k ${q(output)}`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
    );
  }
  console.log(`Trimmed: 0→${endTime}s`);
}

export async function extractFrame(videoPath: string, timestamp: number, outputPath: string): Promise<void> {
  await execAsync(
    ff(`-y -ss ${timestamp} -i ${q(videoPath)} -frames:v 1 -q:v 2 ${q(outputPath)}`),
    { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
  );
}

export async function mergeVideos(v1: string, v2: string, output: string): Promise<void> {
  const dir = path.dirname(output);
  const listPath = path.join(dir, "concat.txt");
  fs.writeFileSync(listPath, `file '${v1}'\nfile '${v2}'`);

  try {
    await execAsync(
      ff(`-y -f concat -safe 0 -i ${q(listPath)} -c copy ${q(output)}`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 120000 }
    );
    console.log("Merge: stream copy OK");
  } catch {
    console.log("Merge: re-encoding...");
    await execAsync(
      ff(`-y -i ${q(v1)} -i ${q(v2)} -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[ov][oa]" -map "[ov]" -map "[oa]" -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 128k ${q(output)}`),
      { maxBuffer: 50 * 1024 * 1024, timeout: 600000 }
    );
    console.log("Merge: re-encode OK");
  }

  try { fs.unlinkSync(listPath); } catch { /* */ }
}
