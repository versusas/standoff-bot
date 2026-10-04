import fs from "fs";
import path from "path";
import axios from "axios";

interface GoFileUploadResult {
  downloadPage: string;
  fileId: string;
  fileName: string;
}

/**
 * Upload a file to GoFile.io (free, no API key needed)
 * Returns a public download link
 */
export async function uploadToGoFile(filePath: string): Promise<GoFileUploadResult> {
  // Step 1: Get best server
  console.log("Getting GoFile server...");
  const serverRes = await axios.get("https://api.gofile.io/servers");
  const servers = serverRes.data?.data?.servers;
  if (!servers || servers.length === 0) {
    throw new Error("No GoFile servers available");
  }
  const server = servers[0].name;
  console.log(`Using GoFile server: ${server}`);

  // Step 2: Upload file
  const fileName = path.basename(filePath);
  const fileStream = fs.createReadStream(filePath);
  const fileSize = fs.statSync(filePath).size;

  console.log(`Uploading ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)}MB) to GoFile...`);

  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("file", fileStream, fileName);

  const uploadRes = await axios.post(`https://${server}.gofile.io/contents/uploadfile`, form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 300000, // 5 min timeout
  });

  if (uploadRes.data?.status !== "ok") {
    throw new Error(`GoFile upload failed: ${JSON.stringify(uploadRes.data)}`);
  }

  const result: GoFileUploadResult = {
    downloadPage: uploadRes.data.data.downloadPage,
    fileId: uploadRes.data.data.fileId,
    fileName: uploadRes.data.data.fileName,
  };

  console.log(`Uploaded to GoFile: ${result.downloadPage}`);
  return result;
}
