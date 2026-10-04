export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center">
      <div className="max-w-lg mx-auto px-6 text-center">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          🎮 Standoff Bot
        </h1>
        <p className="text-gray-400 text-lg mb-8">
          Обработка видео записей Standoff 2
        </p>

        <div className="bg-gray-800/50 rounded-2xl p-8 border border-gray-700/50 text-left space-y-4">
          <h2 className="text-xl font-bold text-center mb-4">Что делает бот:</h2>

          <div className="flex items-start gap-3">
            <span className="text-2xl">✂️</span>
            <p className="text-gray-300">Обрезает чёрный экран в начале первого видео</p>
          </div>

          <div className="flex items-start gap-3">
            <span className="text-2xl">🔗</span>
            <p className="text-gray-300">Склеивает два видео в одно</p>
          </div>

          <div className="flex items-start gap-3">
            <span className="text-2xl">📸</span>
            <p className="text-gray-300">Делает скриншоты вкладок и фазы покупки</p>
          </div>

          <div className="flex items-start gap-3">
            <span className="text-2xl">🔗</span>
            <p className="text-gray-300">Загружает видео и выдаёт публичную ссылку</p>
          </div>
        </div>

        <div className="mt-8">
          <p className="text-gray-500 text-sm">
            Отправь два видео в Telegram-бота и получи результат за ~5 минут
          </p>
        </div>
      </div>
    </div>
  );
}
