import type { Metadata } from "next";
import { Gowun_Dodum, Jua } from "next/font/google";
import "./globals.css";

// 제목·숫자·버튼은 둥글고 굵은 주아, 읽는 글은 고운돋움
const display = Jua({ weight: "400", subsets: ["latin"], variable: "--font-display" });
const body = Gowun_Dodum({ weight: "400", subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Feign",
  description: "친구들과 하는 마피아 게임",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${display.variable} ${body.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
