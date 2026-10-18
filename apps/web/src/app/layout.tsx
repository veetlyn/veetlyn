import type { Metadata } from "next";

import "../index.css";
import Providers from "@/components/providers";
import PwaRegistration from "@/components/pwa-registration";
import SandboxBanner from "@/components/sandbox-banner";

// Payleor's type: Cal Sans for display, Google Sans Flex for text, Montserrat for numbers, IBM Plex Mono for references.
const FONTS =
  "https://fonts.googleapis.com/css2?family=Cal+Sans&family=Google+Sans+Flex:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Montserrat:wght@500;600;700&display=swap";

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
