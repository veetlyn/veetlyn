import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

import { withPwa } from "./pwa.config";

// Both values come from the infra `dev` / `dev:preprod` scripts (see packages/infra/dev-hosts.ts).
const tunnelDomain = process.env.TUNNEL_DOMAIN;

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  // next dev locks its output directory, so the preprod dev server needs its own to run alongside dev.
  distDir: process.env.JENDAL_LOCAL_STAGE === "preprod" ? ".next-preprod" : ".next",
  // next dev blocks dev resources requested from origins it does not know, such as the tunnel hostnames.
  allowedDevOrigins: tunnelDomain ? [tunnelDomain, `*.${tunnelDomain}`] : [],
};

export default withPwa(nextConfig);

initOpenNextCloudflareForDev();
