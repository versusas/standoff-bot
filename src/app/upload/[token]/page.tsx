"use client";

import { useState, useEffect, useCallback } from "react";

interface JobStatus {
  status: string;
  statusMessage: string;
  mergedVideoUrl?: string;
  screenshots?: string[];
  errorMessage?: string;
}

export default function UploadPage() {
  const [token, setToken] = useState<string | null>(null);
  const [video1, setVideo1] = useState<File | null>(null);
  const [video2, setVideo2] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);

  // Safely get token from URL without relying on Next.js navigation hooks
  // which might be causing the blank screen
  useEffect(() => {
    try {
      const pathParts = window.location.pathname.split("/");
      const extractedToken = pathParts[pathParts.length - 1];
      
      if (extractedToken && extractedToken !== "upload") {
        setToken(extractedToken);
      } else {
        setValid(false);
        setError("Токен не найден в URL");
      }
    } catch (e) {
      setValid(false);
      setError("Ошибка чтения URL");
    }
  }, []);

  // Verify token on load
  useEffect(() => {
    if (!token) return;

    fetch(`/api/session/${token}`)
      .then((r) => {
        setValid(r.ok);
        if (!r.ok) {
          setError("Ссылка недействительна. Нажми /start в боте.");
        }
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
    } catch {
      // ignore poll errors
    }
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
    if (!video1 || !video2 || !token) {
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
      processing: 15,
      detecting: 25,
      trimming: 45,
      screenshots: 60,
      merging: 75,
      uploading: 90,
      completed: 100,
      error: 100,
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
        <div className="text-center max-w-md">
          <p className="text-6xl mb-4">❌</p>
          <p className="text-xl text-red-400">{error}</p>
          <p className="text-gray-500 mt-4">
            Нажми /start в Telegram-боте чтобы получить новую ссылку
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <div className="max-w-lg mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            🎮 Standoff Bot
          </h1>
          <p className="text-gray-400 mt-2">Загрузи 2 видео для обработки</p>
        </div>

        {!jobId && (
          <div className="space-y-6">
            <div className="bg-gray-800/80 rounded-2xl p-5 border border-gray-700/50 shadow-xl">
              <label className="block mb-3">
                <span className="font-bold text-blue-400 text-lg">📹 Видео 1</span>
                <span className="text-sm text-gray-400 ml-2">(системные настройки → игра)</span>
              </label>
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setVideo1(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-300 file:mr-4 file:py-3 file:px-4 file:rounded-xl file:border-0 file:bg-blue-600 hover:file:bg-blue-700 file:text-white file:font-bold file:cursor-pointer cursor-pointer transition-colors"
              />
              {video1 && (
                <p className="text-sm text-green-400 mt-2 font-medium">
                  ✓ {video1.name} ({(video1.size / 1024 / 1024).toFixed(0)} МБ)
                </p>
              )}
            </div>

            <div className="bg-gray-800/80 rounded-2xl p-5 border border-gray-700/50 shadow-xl">
              <label className="block mb-3">
                <span className="font-bold text-purple-400 text-lg">📹 Видео 2</span>
                <span className="text-sm text-gray-400 ml-2">(геймплей + вкладки)</span>
              </label>
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setVideo2(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-300 file:mr-4 file:py-3 file:px-4 file:rounded-xl file:border-0 file:bg-purple-600 hover:file:bg-purple-700 file:text-white file:font-bold file:cursor-pointer cursor-pointer transition-colors"
              />
              {video2 && (
                <p className="text-sm text-green-400 mt-2 font-medium">
                  ✓ {video2.name} ({(video2.size / 1024 / 1024).toFixed(0)} МБ)
                </p>
              )}
            </div>

            {error && (
              <div className="bg-red-900/40 border border-red-700/50 rounded-xl p-4 text-red-300 font-medium">
                ⚠️ {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={uploading || !video1 || !video2}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 rounded-xl text-lg font-bold transition-all shadow-lg hover:shadow-xl active:scale-95"
            >
              {uploading ? "⏳ Загружаю..." : "🚀 Обработать видео"}
            </button>

            {uploading && (
              <div className="bg-gray-800/80 rounded-xl p-4 shadow-inner">
                <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-purple-500 h-4 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-center text-sm font-medium text-gray-300 mt-2">{uploadProgress}%</p>
              </div>
            )}
          </div>
        )}

        {jobId && (
          <div className="space-y-6">
            <div className="bg-gray-800/80 rounded-2xl p-6 border border-gray-700/50 shadow-xl">
              <div className="w-full bg-gray-700 rounded-full h-5 mb-4 overflow-hidden shadow-inner">
                <div
                  className={`h-5 rounded-full transition-all duration-700 ${
                    job?.status === "error"
                      ? "bg-red-500"
                      : job?.status === "completed"
                        ? "bg-green-500"
                        : "bg-gradient-to-r from-blue-500 to-purple-500"
                  }`}
                  style={{ width: `${getProgress()}%` }}
                />
              </div>
              <p className="text-gray-200 font-medium text-lg text-center">
                {job?.statusMessage || "Начинаю обработку..."}
              </p>

              {job && job.status !== "completed" && job.status !== "error" && (
                <div className="flex justify-center mt-6">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            {job?.status === "completed" && (
              <div className="space-y-4">
                {job.mergedVideoUrl && (
                  <div className="bg-green-900/30 border border-green-700/50 rounded-2xl p-6 text-center shadow-lg">
                    <p className="text-green-400 font-bold text-xl mb-4">🎬 Видео готово!</p>
                    <a
                      href={job.mergedVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block w-full bg-green-600 hover:bg-green-500 py-4 rounded-xl font-bold text-lg transition-colors shadow-lg"
                    >
                      📥 Скачать видео
                    </a>
                  </div>
                )}

                <div className="bg-blue-900/30 border border-blue-700/50 rounded-2xl p-6 text-center shadow-lg">
                  <p className="text-blue-400 font-bold text-lg">📸 Скриншоты отправлены в Telegram</p>
                  <p className="text-gray-400 text-sm mt-2">Открой чат с ботом чтобы посмотреть их</p>
                </div>
              </div>
            )}

            {job?.status === "error" && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-2xl p-6 shadow-lg">
                <p className="text-red-400 font-medium text-center">{job.errorMessage}</p>
              </div>
            )}
          </div>
        )}

        <div className="mt-10 pt-6 border-t border-gray-800 text-center">
          <p className="text-gray-500 text-sm">
            ⚡ ~5 минут на обработку • Не закрывай вкладку при загрузке
          </p>
        </div>
      </div>
    </div>
  );
}
