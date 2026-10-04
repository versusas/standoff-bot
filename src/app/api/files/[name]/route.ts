import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const url = new URL(request.url);
    const dir = url.searchParams.get("dir");

    if (!dir || !name) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    // Security: only allow files from /tmp
    if (!dir.startsWith("/tmp/")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const filePath = path.join(dir, name);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const fileStream = fs.readFileSync(filePath);

    const ext = path.extname(name).toLowerCase();
    let contentType = "application/octet-stream";
    if (ext === ".mp4") contentType = "video/mp4";
    else if (ext === ".png") contentType = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";

    return new NextResponse(fileStream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": stat.size.toString(),
        "Content-Disposition": `inline; filename="${name}"`,
      },
    });
  } catch (error) {
    console.error("File serve error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
