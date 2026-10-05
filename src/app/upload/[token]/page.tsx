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
  const [token, setToken] = useState<string>("");
  const [video1, setVideo1] = useState<File | null>(null);
  const [video2, setVideo2] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Set mounted state to true after hydration to safely use client-side APIs
  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      const pathParts = window.location.pathname.split("/");
      const extractedToken = pathParts[pathParts.length - 1];
      if (extractedToken && extractedToken !== "upload") {
        setToken(extractedToken);
      }
    }
  }, []);

  const pollJob = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/jobs/${id}`);
      if (res.ok) {
        const data: JobStatus = await res.json();
        setJob(data);
        return data.status === "completed" || data.status === "error";
      }
    } catch { /* ignore */ }
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
      setError("Пожалуйста, выбери оба видеофайла.");
      return;
    }
    if (!token) {
      setError("Токен не найден. Попробуй получить новую ссылку в боте.");
      return;
    }

    setError(null);
    setUploading(true);
    setUploadProgress(5);

    try {
      const formData = new FormData();
      formData.append("video1", video1);
      formData.append("video2", video2);
      formData.append("token", token);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 95);
          setUploadProgress(percent);
        }
      };

      const response = await new Promise<string>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.responseText);
          } else {
            reject(new Error(`Server returned ${xhr.status}: ${xhr.responseText}`));
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(formData);
      });

      const data = JSON.parse(response);
      if (data.error) throw new Error(data.error);

      setJobId(data.jobId);
      setUploading(false);
      setUploadProgress(100);
    } catch (err) {
      console.error("Upload error:", err);
      setError(err instanceof Error ? err.message : "Произошла ошибка при загрузке");
      setUploading(false);
    }
  };

  const getProgress = () => {
    if (!job) return uploading ? uploadProgress : 0;
    const map: Record<string, number> = {
      processing: 10, detecting: 25, trimming: 45,
      screenshots: 65, merging: 80, uploading: 90,
      completed: 100, error: 100,
    };
    return map[job.status] || 10;
  };

  // Prevent hydration mismatch: show nothing until mounted on client
  if (!mounted) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="animate-pulse text-gray-500 font-medium">Загрузка интерфейса...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-gray-100 font-sans selection:bg-blue-500/30">
      <div className="max-w-md mx-auto px-6 py-12">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600/20 rounded-2xl mb-4 border border-blue-500/30">
            <span className="text-3xl">🎮</span>
          </div>
          <h1 className="text-4xl font-black tracking-tight text-white mb-2">
            Standoff <span className="text-blue-500">Bot</span>
          </h1>
          <p className="text-gray-400 font-medium">Обработка игровых моментов</p>
        </div>

        {!jobId && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Input 1 */}
            <div className="bg-gray-800/40 backdrop-blur-sm rounded-3xl p-6 border border-gray-700/50 hover:border-blue-500/30 transition-all duration-300">
              <label className="block mb-4">
                <span className="text-sm font-bold uppercase tracking-wider text-blue-400">📹 Видео №1</span>
                <p className="text-xs text-gray-500 mt-1">Системные настройки + вход в игру</p>
              </label>
              <div className="relative group">
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => setVideo1(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-gray-400 file:mr-4 file:py-2.5 file:px-5 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-blue-600 file:text-white hover:file:bg-blue-700 transition-all cursor-pointer"
                />
              </div>
              {video1 && (
                <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-green-400 bg-green-400/10 py-1.5 px-3 rounded-lg w-fit">
                  <span>✓</span> {video1.name.slice(0, 20)}... ({(video1.size / 1024 / 1024).toFixed(1)} МБ)
                </div>
              )}
            </div>

            {/* Input 2 */}
            <div className="bg-gray-800/40 backdrop-blur-sm rounded-3xl p-6 border border-gray-700/50 hover:border-purple-500/30 transition-all duration-300">
              <label className="block mb-4">
                <span className="text-sm font-bold uppercase tracking-wider text-purple-400">📹 Видео №2</span>
                <p className="text-xs text-gray-500 mt-1">Игровой процесс + открытие вкладок</p>
              </label>
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setVideo2(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-400 file:mr-4 file:py-2.5 file:px-5 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-purple-600 file:text-white hover:file:bg-purple-700 transition-all cursor-pointer"
              />
              {video2 && (
                <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-green-400 bg-green-400/10 py-1.5 px-3 rounded-lg w-fit">
                  <span>✓</span> {video2.name.slice(0, 20)}... ({(video2.size / 1024 / 1024).toFixed(1)} МБ)
                </div>
              )}
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl text-sm font-bold text-center">
                ⚠️ {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={uploading || !video1 || !video2}
              className="w-full py-5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-3xl font-black text-lg transition-all duration-300 shadow-xl shadow-blue-900/20 active:scale-[0.97]"
            >
              {uploading ? (
                <span className="flex items-center justify-center gap-3">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ЗАГРУЖАЮ...
                </span>
              ) : "НАЧАТЬ ОБРАБОТКУ"}
            </button>

            {uploading && (
              <div className="mt-4 animate-in fade-in duration-500">
                <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-blue-600 h-full transition-all duration-500 ease-out"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <div className="flex justify-between mt-2 text-[10px] font-black uppercase text-gray-500 tracking-widest">
                  <span>Progress</span>
                  <span>{uploadProgress}%</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Status Section */}
        {jobId && (
          <div className="space-y-6 animate-in zoom-in-95 duration-500">
            <div className="bg-gray-800/40 backdrop-blur-sm rounded-3xl p-8 border border-gray-700/50 text-center">
              <div className="w-full bg-gray-900 rounded-full h-3 mb-6 overflow-hidden border border-gray-800">
                <div
                  className={`h-full transition-all duration-1000 ease-in-out ${
                    job?.status === "error" ? "bg-red-500" :
                    job?.status === "completed" ? "bg-green-500" : "bg-blue-500"
                  }`}
                  style={{ width: `${getProgress()}%` }}
                />
              </div>
              
              <h3 className="text-xl font-bold text-white mb-2">
                {job?.status === "completed" ? "ГОТОВО!" : 
                 job?.status === "error" ? "ОШИБКА" : "ОБРАБАТЫВАЮ..."}
              </h3>
              
              <p className="text-gray-400 font-medium">
                {job?.statusMessage || "Подготовка..."}
              </p>

              {job?.status !== "completed" && job?.status !== "error" && (
                <div className="mt-8 flex justify-center">
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" />
                  </div>
                </div>
              )}
            </div>

            {job?.status === "completed" && (
              <div className="space-y-4 animate-in slide-in-from-top-4 duration-700">
                <a
                  href={job.mergedVideoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full bg-green-600 hover:bg-green-500 text-white text-center py-5 rounded-3xl font-black text-lg transition-all shadow-xl shadow-green-900/20 active:scale-[0.97]"
                >
                  📥 СКАЧАТЬ ВИДЕО
                </a>
                
                <div className="bg-blue-500/10 border border-blue-500/20 p-5 rounded-3xl text-center">
                  <p className="text-blue-400 font-bold text-sm">📸 Скриншоты уже в Telegram чате!</p>
                </div>
              </div>
            )}

            {job?.status === "error" && (
              <div className="bg-red-500/10 border border-red-500/20 p-5 rounded-3xl text-center">
                <p className="text-red-400 font-bold">{job.errorMessage}</p>
                <button 
                  onClick={() => window.location.reload()}
                  className="mt-4 text-xs font-black text-gray-400 underline uppercase tracking-widest"
                >
                  Попробовать снова
                </button>
              </div>
            )}
          </div>
        )}

        <footer className="mt-12 text-center">
          <p className="text-[10px] font-black uppercase text-gray-600 tracking-[0.2em]">
            Standoff 2 Gameplay Processor • Seamless Sync
          </p>
        </footer>
      </div>
    </div>
  );
}
