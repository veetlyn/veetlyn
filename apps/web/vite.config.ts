import { env } from "node:process";

import vinext from "vinext";
import { defineConfig } from "vite";

// Both values come from the infra `dev` / `dev:preprod` scripts (packages/infra/dev-hosts.ts).
const tunnelDomain = env.TUNNEL_DOMAIN;

export default defineConfig({
  plugins: [vinext({ react: { compiler: true } })],
  // Each stage's dev server gets its own dependency cache, so dev and preprod can run at once.
  cacheDir: env.JENDAL_LOCAL_STAGE === "preprod" ? "node_modules/.vite-preprod" : undefined,
  server: {
    // Vite rejects unknown Host headers; the tunnel sends D and *.D. A leading dot allows subdomains.
    allowedHosts: tunnelDomain ? [`.${tunnelDomain}`] : [],
  },
});
