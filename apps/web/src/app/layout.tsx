import type { Metadata } from "next";
import { Noto_Sans_JP, Space_Grotesk } from "next/font/google";
import "./globals.css";

const sans = Noto_Sans_JP({ subsets: ["latin"], variable: "--font-sans" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Palworld サーバー接続ガイド",
  description: "Palworld専用サーバーの参加方法、稼働状況、Discord Bot操作ガイド。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body className={`${sans.variable} ${display.variable}`}>{children}</body></html>;
}
