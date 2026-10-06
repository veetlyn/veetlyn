// Cloudflare named tunnel for one local stage, on TUNNEL_DOMAIN with the production host layout.
//   node scripts/tunnel.ts setup [--overwrite-dns]   creates the tunnel and its DNS records (after `cloudflared tunnel login`)
//   node scripts/tunnel.ts run                       starts the tunnel for TUNNEL_STAGE
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { localPorts, type TunnelSettings, tunnelIngress, tunnelSettings } from "../dev-hosts.ts";

const TUNNEL_NAME = process.env.TUNNEL_NAME ?? "jendal-local";
const CLOUDFLARED_DIR = join(homedir(), ".cloudflared");
const PACKAGE_DIR = join(import.meta.dirname, "..");
const CONFIG_PATH = join(PACKAGE_DIR, ".tunnel", "config.yml");

function fail(message: string): never {
  console.error(`tunnel: ${message}`);
  process.exit(1);
}

// Values already in the environment win over packages/infra/.env, as with varlock in alchemy.run.ts.
function readSettings(): TunnelSettings {
  const envFile = join(PACKAGE_DIR, ".env");
  const fileEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
  const settings = tunnelSettings({ ...fileEnv, ...process.env });
  if (!settings) fail("set TUNNEL_DOMAIN in packages/infra/.env (for example payleor.com).");
  return settings;
}

function cloudflared(args: string[]): string {
  try {
    return execFileSync("cloudflared", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      fail("cloudflared is not installed. See https://developers.cloudflare.com/tunnel/downloads/");
    }
    throw error;
  }
}

function findTunnelId(): string | undefined {
  const tunnels: unknown = JSON.parse(cloudflared(["tunnel", "list", "--output", "json", "--name", TUNNEL_NAME]));
  if (!Array.isArray(tunnels)) return undefined;
  const match: unknown = tunnels.find(
    (t: unknown) => typeof t === "object" && t !== null && "name" in t && t.name === TUNNEL_NAME,
  );
  return typeof match === "object" && match !== null && "id" in match && typeof match.id === "string"
    ? match.id
    : undefined;
}

function setup(overwriteDns: boolean): void {
  const settings = readSettings();
  if (!existsSync(join(CLOUDFLARED_DIR, "cert.pem"))) {
    fail(`run \`cloudflared tunnel login\` first and pick the ${settings.domain} zone.`);
  }

  let tunnelId = findTunnelId();
  if (tunnelId) {
    console.log(`Tunnel ${TUNNEL_NAME} already exists (${tunnelId}).`);
  } else {
    execFileSync("cloudflared", ["tunnel", "create", TUNNEL_NAME], { stdio: "inherit" });
    tunnelId = findTunnelId();
    if (!tunnelId) fail(`created ${TUNNEL_NAME} but could not find it in \`cloudflared tunnel list\`.`);
  }

  // The DNS records are the same for every stage; only the ingress ports change.
  // Without --overwrite-dns, an existing record that points elsewhere is reported, never replaced.
  // cloudflared logs to stderr, so its output is passed through as is.
  for (const { hostname } of tunnelIngress(settings)) {
    const args = ["tunnel", "route", "dns", ...(overwriteDns ? ["--overwrite-dns"] : []), TUNNEL_NAME, hostname];
    try {
      execFileSync("cloudflared", args, { stdio: "inherit" });
    } catch {
      console.error(`Could not route ${hostname}; see the cloudflared message above.`);
    }
  }
  console.log("\nDone. Start it with: pnpm tunnel");
}

function writeConfig(settings: TunnelSettings, tunnelId: string): void {
  const credentialsFile = join(CLOUDFLARED_DIR, `${tunnelId}.json`);
  if (!existsSync(credentialsFile)) {
    fail(`missing ${credentialsFile}. Run \`pnpm tunnel:setup\` on the machine that created the tunnel.`);
  }
  const rules = tunnelIngress(settings)
    .map(({ hostname, port }) => `  - hostname: "${hostname}"\n    service: http://localhost:${port}`)
    .join("\n");
  mkdirSync(join(PACKAGE_DIR, ".tunnel"), { recursive: true });
  writeFileSync(
    CONFIG_PATH,
    `tunnel: ${tunnelId}\ncredentials-file: ${credentialsFile}\ningress:\n${rules}\n  - service: http_status:404\n`,
  );
}

function run(): void {
  const settings = readSettings();
  const tunnelId = findTunnelId();
  if (!tunnelId) fail(`no tunnel named ${TUNNEL_NAME}. Run \`pnpm tunnel:setup\` first.`);

  writeConfig(settings, tunnelId);
  cloudflared(["tunnel", "--config", CONFIG_PATH, "ingress", "validate"]);

  const startCommand = settings.stage === "dev" ? "pnpm dev" : "pnpm dev:preprod";
  console.log(`Serving the ${settings.stage} stage (start it with \`${startCommand}\`):`);
  for (const { hostname, port } of tunnelIngress(settings)) {
    console.log(`  https://${hostname.padEnd(24)} -> http://localhost:${port}`);
  }
  const otherStage = settings.stage === "dev" ? "preprod" : "dev";
  console.log(`The ${otherStage} stage stays on http://localhost:${localPorts(otherStage).web}.`);

  const child = spawn("cloudflared", ["tunnel", "--config", CONFIG_PATH, "run"], { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code ?? 0));
}

const [command, ...flags] = process.argv.slice(2);
if (command === "setup") setup(flags.includes("--overwrite-dns"));
else if (command === "run") run();
else fail("usage: node scripts/tunnel.ts <setup [--overwrite-dns] | run>");
