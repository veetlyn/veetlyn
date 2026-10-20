import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Payleor",
    short_name: "Payleor",
    description: "Agentic commerce on PayPal",
    start_url: "/",
    display: "standalone",
    // The manifest takes literal colours: the light theme's --background and --primary.
    background_color: "#f6f6f7",
    theme_color: "#1c1c20",
    icons: [
      {
        src: "/favicon/web-app-manifest-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/favicon/web-app-manifest-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
