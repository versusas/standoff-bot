export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center">
      <div className="max-w-md mx-auto px-6 text-center">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          🎮 Standoff Bot
        </h1>
        <p className="text-gray-400 text-lg mb-8">
          Обработка видео записей Standoff 2
        </p>

        <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50 text-left space-y-3 text-sm">
          <p className="text-gray-300">1️⃣ Напиши <span className="text-blue-400 font-mono">/start</span> боту в Telegram</p>
          <p className="text-gray-300">2️⃣ Открой ссылку которую пришлёт бот</p>
          <p className="text-gray-300">3️⃣ Загрузи два видео</p>
          <p className="text-gray-300">4️⃣ Получи результат прямо в Telegram</p>
        </div>

        <p className="text-gray-600 text-xs mt-6">⚡ ~5 минут на обработку</p>
      </div>
    </div>
  );
}
