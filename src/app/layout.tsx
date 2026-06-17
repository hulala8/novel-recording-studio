import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "小说录音工作室",
  description: "分角色录制有声小说，支持 AI 角色识别与多音轨编辑",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="h-full flex flex-col bg-zinc-950 text-zinc-100">
        {children}
      </body>
    </html>
  );
}
