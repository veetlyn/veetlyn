import type { Metadata } from "next";

import "../index.css";
import Providers from "@/components/providers";
import PwaRegistration from "@/components/pwa-registration";
import SandboxBanner from "@/components/sandbox-banner";

// Payleor's type: Geist for everything, Geist Mono for references.
const FONTS = "https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400;500&display=swap";

export const metadata: Metadata = {
  title: "Payleor",
  description: "Stores and services teams, paid through PayPal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body className="flex min-h-svh flex-col antialiased">
        <PwaRegistration />
        <SandboxBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
