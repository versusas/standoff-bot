import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { processVideos } from "@/lib/pipeline";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const video1 = formData.get("video1") as File | null;
    const video2 = formData.get("video2") as File | null;

    if (!video1 || !video2) {
      return NextResponse.json(
        { error: "Нужно загрузить оба видео (video1 и video2)" },
        { status: 400 }
      );
    }

    // Create work directory
    const jobDir = path.join("/tmp", `job_${Date.now()}`);
    fs.mkdirSync(jobDir, { recursive: true });

    // Save video files to disk
    const video1Path = path.join(jobDir, "video1.mp4");
    const video2Path = path.join(jobDir, "video2.mp4");

    const [buf1, buf2] = await Promise.all([
      video1.arrayBuffer(),
      video2.arrayBuffer(),
    ]);

    fs.writeFileSync(video1Path, Buffer.from(buf1));
    fs.writeFileSync(video2Path, Buffer.from(buf2));

    console.log(
      `Files saved: ${video1.name} (${(buf1.byteLength / 1024 / 1024).toFixed(1)}MB), ${video2.name} (${(buf2.byteLength / 1024 / 1024).toFixed(1)}MB)`
    );

    // Create job record
    const [job] = await db
      .insert(jobs)
      .values({
        status: "processing",
        statusMessage: "📤 Файлы загружены, начинаю обработку...",
        video1Name: video1.name,
        video2Name: video2.name,
      })
      .returning();

    // Start processing in background (don't await!)
    processVideos(job.id, video1Path, video2Path).catch((err) => {
      console.error("Pipeline error:", err);
    });

    return NextResponse.json({
      jobId: job.id,
      message: "Обработка начата!",
    });
  } catch (error) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
