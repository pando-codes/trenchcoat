import { RootProvider } from "fumadocs-ui/provider/next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./global.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { template: "%s — Trenchcoat Docs", default: "Trenchcoat Docs" },
  description: "Documentation for Trenchcoat — observability for AI agents.",
  icons: { icon: "/favicon.svg" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <body style={{ fontFamily: "var(--font-geist-sans, ui-sans-serif, system-ui, sans-serif)" }}>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
