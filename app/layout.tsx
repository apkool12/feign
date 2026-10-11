import type { Metadata } from "next";
import { Jua } from "next/font/google";
import "./globals.css";

// 글꼴은 둥근 주아 하나로 통일한다
const display = Jua({ weight: "400", subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Feign",
  description: "친구들과 하는 마피아 게임",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
