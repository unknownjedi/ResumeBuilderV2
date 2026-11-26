import type { Metadata } from "next";
import { headers } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { MotionProvider } from "@/components/motion/motion-provider";
import { SseProvider } from "@/components/shell/sse-provider";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Personal Job Copilot",
    template: "%s · Personal Job Copilot",
  },
  description:
    "Local-first workbench for job discovery, evidence-backed resume tailoring, and application tracking.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerList = await headers();
  const nonce = headerList.get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body>
        <MotionProvider nonce={nonce}>
          <SseProvider>
            <ToastProvider>{children}</ToastProvider>
          </SseProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
