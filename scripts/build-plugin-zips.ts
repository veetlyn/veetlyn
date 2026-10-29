// Builds the plugin zips judges and testers upload: <plugin>-plugin.zip for Claude (the folder inside the zip)
// and <plugin>-plugin-chatgpt.zip for ChatGPT (files at the root, as its upload expects). <plugin> is the folder
// under plugins/. PLATFORM_NAME and PLATFORM_DOMAIN come from the environment (apps/server/.env.schema).
// Usage: pnpm plugin:zip [--staging | --mcp-url https://api.staging.example.com/mcp]
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

import { z } from "zod";

const ROOT = new URL("..", import.meta.url).pathname;
const PLUGINS = join(ROOT, "plugins");
const OUT = join(ROOT, "dist/plugin");

const env = z.object({ PLATFORM_NAME: z.string().min(1), PLATFORM_DOMAIN: z.string().min(1) }).parse(process.env);
const PRODUCTION_MCP_URL = `https://api.${env.PLATFORM_DOMAIN}/mcp`;
// The URL a plugin file carries for the connector, whatever stage it was written for.
const CONNECTOR_URL = /https:\/\/api\.[a-z0-9.-]+\/mcp/g;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)]))),
  );
  return nested.flat().sort();
}

type Entry = { name: string; data: Buffer };

// 1 January 1980, the zip format's first day: a fixed date keeps the zips identical from build to build.
const DOS_DATE = (1 << 5) | 1;

// A plain zip (deflate, no extras): local headers, then the central directory.
function zip(entries: readonly Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const packed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const [pluginName, ...otherPlugins] = (await readdir(PLUGINS, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
if (!pluginName || otherPlugins.length > 0) throw new Error("plugins/ must hold exactly one plugin folder");
const SOURCE = join(PLUGINS, pluginName);

const mcpUrl = argValue("--mcp-url") ?? (process.argv.includes("--staging") ? `https://api.staging.${env.PLATFORM_DOMAIN}/mcp` : PRODUCTION_MCP_URL);
if (!/^https:\/\/[a-z0-9.-]+\/mcp$/.test(mcpUrl)) throw new Error(`Not an MCP endpoint URL: ${mcpUrl}`);

const stage = mcpUrl === PRODUCTION_MCP_URL ? null : (new URL(mcpUrl).hostname.split(".")[1] ?? "custom");
const suffix = stage ? `-${stage}` : "";
const stageLabel = stage ? ` ${stage.charAt(0).toUpperCase()}${stage.slice(1)}` : "";

// A staging build points the connector at its stage and carries the stage in its name, so a host can install
// it next to the production plugin instead of replacing it.
function forStage(name: string, text: string): string {
  const platformDomain = new URL(mcpUrl).hostname.replace(/^api\./, "");
  text = text.replace(CONNECTOR_URL, mcpUrl)
    .replaceAll(`https://dash.${env.PLATFORM_DOMAIN}`, `https://dash.${platformDomain}`);
  if (name === "mcp.json" || name === ".mcp.json") return text;
  if (name !== "plugin.json" && name !== ".claude-plugin/plugin.json") return text;
  return text
    .replace(`"name": "${pluginName}"`, `"name": "${pluginName}${suffix}"`)
    .replaceAll(/"displayName": "[^"]*"/g, `"displayName": ${JSON.stringify(`${env.PLATFORM_NAME}${stageLabel}`)}`);
}

const files: Entry[] = await Promise.all(
  (await listFiles(SOURCE)).map(async (path) => {
    const name = relative(SOURCE, path);
    return { name, data: Buffer.from(forStage(name, await readFile(path, "utf8")), "utf8") };
  }),
);

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, `${pluginName}-plugin${suffix}.zip`), zip(files.map((f) => ({ ...f, name: `${pluginName}/${f.name}` }))));
await writeFile(join(OUT, `${pluginName}-plugin-chatgpt${suffix}.zip`), zip(files));
console.log(`Wrote ${files.length} files for ${mcpUrl} to dist/plugin/`);
