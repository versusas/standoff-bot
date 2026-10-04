import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "🎮 Видео Процессор — Standoff 2",
  description: "Обрезка, склеивание видео и скриншоты. Загрузка на Google Drive.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-gray-900 text-white antialiased">{children}</body>
    </html>
  );
}
