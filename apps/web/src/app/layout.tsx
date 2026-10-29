import type { Metadata } from "next";

import "../index.css";
import Providers from "@/components/providers";
import PwaRegistration from "@/components/pwa-registration";
import { PlatformNameProvider } from "@/components/platform-name";
import SandboxBanner from "@/components/sandbox-banner";
import { platformDomain, platformName, storeDomain } from "@/lib/platform";

// The platform's type: Cal Sans UI for headings (self-hosted in public/fonts), Inter for text and numbers, Geist Mono for references.
const FONTS = "https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=Geist+Mono:wght@400;500&display=swap";

export function generateMetadata(): Metadata {
  return {
    title: platformName(),
    description: "Sell where clients ask AI. Your services inside Claude and ChatGPT, paid through PayPal.",
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
        { url: "/favicon/favicon.svg", type: "image/svg+xml" },
      ],
      apple: "/favicon/apple-touch-icon.png",
    },
  };
}

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
        <link rel="preload" href="/fonts/CalSansUI-Variable.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body className="flex min-h-svh flex-col antialiased has-[[data-app-shell]]:h-svh has-[[data-app-shell]]:overflow-hidden">
        <PwaRegistration />
        <SandboxBanner />
        <PlatformNameProvider name={platformName()} domain={platformDomain()} storeDomain={storeDomain()}>
          <Providers>{children}</Providers>
        </PlatformNameProvider>
      </body>
    </html>
  );
}
