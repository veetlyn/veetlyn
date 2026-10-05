import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "../index.css";
import Providers from "@/components/providers";
import PwaRegistration from "@/components/pwa-registration";
import SandboxBanner from "@/components/sandbox-banner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Payleor",
  description: "Agentic commerce on PayPal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} flex min-h-svh flex-col antialiased`}>
        <PwaRegistration />
        <SandboxBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
