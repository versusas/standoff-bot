"use client";

import { useState, useEffect, useCallback, use } from "react";

interface JobStatus {
  status: string;
  statusMessage: string;
  mergedVideoUrl?: string;
  screenshots?: string[];
  errorMessage?: string;
}

export default function UploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [video1, setVideo1] = useState<File | null>(null);
  const [video2, setVideo2] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);

  // Verify token on load
  useEffect(() => {
    fetch(`/api/session/${token}`)
      .then((r) => {
        setValid(r.ok);
        if (!r.ok) setError("Ссылка недействительна. Нажми /start в боте.");
      })
      .catch(() => {
        setValid(false);
        setError("Ошибка проверки ссылки.");
      });
  }, [token]);

  const pollJob = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/jobs/${id}`);
      if (res.ok) {
        const data: JobStatus = await res.json();
        setJob(data);
        return data.status === "completed" || data.status === "error";
      }
    } catch { /* */ }
    return false;
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(async () => {
      const done = await pollJob(jobId);
      if (done) clearInterval(interval);
    }, 3000);
    return () => clearInterval(interval);
  }, [jobId, pollJob]);

  const handleSubmit = async () => {
    if (!video1 || !video2) {
      setError("Загрузи оба видео!");
      return;
    }
    setError(null);
    setUploading(true);
    setUploadProgress(10);

    try {
      const formData = new FormData();
      formData.append("video1", video1);
      formData.append("video2", video2);
      formData.append("token", token);

      setUploadProgress(20);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 90) + 10);
        }
      };

      const response = await new Promise<string>((resolve, reject) => {
        xhr.onload = () => resolve(xhr.responseText);
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(formData);
      });

      const data = JSON.parse(response);
      if (data.error) throw new Error(data.error);

      setJobId(data.jobId);
      setUploading(false);
      setUploadProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
      setUploading(false);
    }
  };

  const getProgress = () => {
    if (!job) return uploading ? uploadProgress : 0;
    const map: Record<string, number> = {
      processing: 15, detecting: 25, trimming: 45,
      screenshots: 60, merging: 75, uploading: 90,
      completed: 100, error: 100,
    };
    return map[job.status] || 10;
  };

  if (valid === null) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (valid === false) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-6xl mb-4">❌</p>
          <p className="text-xl text-red-400">{error}</p>
          <p className="text-gray-500 mt-2">Нажми /start в Telegram-боте чтобы получить новую ссылку</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            🎮 Standoff Bot
          </h1>
          <p className="text-gray-400 text-sm mt-1">Загрузи 2 видео для обработки</p>
        </div>

        {!jobId && (
          <div className="space-y-4">
            {/* Video 1 */}
            <div className="bg-gray-800/60 rounded-xl p-4 border border-gray-700/50">
              <label className="block mb-2">
                <span className="font-semibold text-blue-400">📹 Видео 1</span>
                <span className="text-xs text-gray-500 ml-2">(настройки → открытие игры)</span>
              </label>
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setVideo1(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:text-sm file:font-semibold"
              />
              {video1 && (
                <p className="text-xs text-green-400 mt-1">
                  ✓ {video1.name} ({(video1.size / 1024 / 1024).toFixed(0)} МБ)
                </p>
              )}
            </div>

            {/* Video 2 */}
            <div className="bg-gray-800/60 rounded-xl p-4 border border-gray-700/50">
              <label className="block mb-2">
                <span className="font-semibold text-purple-400">📹 Видео 2</span>
                <span className="text-xs text-gray-500 ml-2">(игра + вкладки)</span>
              </label>
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setVideo2(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-purple-600 file:text-white file:text-sm file:font-semibold"
              />
              {video2 && (
                <p className="text-xs text-green-400 mt-1">
                  ✓ {video2.name} ({(video2.size / 1024 / 1024).toFixed(0)} МБ)
                </p>
              )}
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-3 text-red-300 text-sm">
                ⚠️ {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={uploading || !video1 || !video2}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-600 rounded-xl text-lg font-bold transition-all"
            >
              {uploading ? "⏳ Загружаю..." : "🚀 Обработать"}
            </button>

            {uploading && (
              <div className="bg-gray-800/50 rounded-xl p-3">
                <div className="w-full bg-gray-700 rounded-full h-3">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-purple-500 h-3 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-center text-xs text-gray-400 mt-1">{uploadProgress}%</p>
              </div>
            )}
          </div>
        )}

        {/* Processing */}
        {jobId && (
          <div className="space-y-4">
            <div className="bg-gray-800/60 rounded-xl p-5 border border-gray-700/50">
              <div className="w-full bg-gray-700 rounded-full h-4 mb-3">
                <div
                  className={`h-4 rounded-full transition-all duration-700 ${
                    job?.status === "error" ? "bg-red-500" :
                    job?.status === "completed" ? "bg-green-500" :
                    "bg-gradient-to-r from-blue-500 to-purple-500"
                  }`}
                  style={{ width: `${getProgress()}%` }}
                />
              </div>
              <p className="text-gray-300">{job?.statusMessage || "Начинаю обработку..."}</p>

              {job && job.status !== "completed" && job.status !== "error" && (
                <div className="flex justify-center mt-4">
                  <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            {job?.status === "completed" && (
              <div className="space-y-3">
                {job.mergedVideoUrl && (
                  <div className="bg-green-900/20 border border-green-700/50 rounded-xl p-4">
                    <p className="text-green-400 font-bold mb-2">🎬 Видео готово!</p>
                    <a
                      href={job.mergedVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full text-center bg-green-600 hover:bg-green-700 py-3 rounded-lg font-semibold transition-colors"
                    >
                      📥 Скачать видео
                    </a>
                    <p className="text-xs text-gray-500 mt-2 text-center">
                      Результат также отправлен в Telegram
                    </p>
                  </div>
                )}

                {job.screenshots && job.screenshots.length > 0 && (
                  <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl p-4">
                    <p className="text-blue-400 font-bold mb-2">📸 Скриншоты отправлены в Telegram</p>
                  </div>
                )}
              </div>
            )}

            {job?.status === "error" && (
              <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-4">
                <p className="text-red-400">{job.errorMessage}</p>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-xs text-gray-600 mt-8">
          ⚡ ~5 минут на обработку • Результат придёт в Telegram
        </p>
      </div>
    </div>
  );
}
