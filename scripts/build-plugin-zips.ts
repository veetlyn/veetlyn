// Builds the plugin zips judges and testers upload: payleor-plugin.zip for Claude (the folder inside the zip)
// and payleor-plugin-chatgpt.zip for ChatGPT (files at the root, as its upload expects).
// Usage: pnpm plugin:zip [--mcp-url https://api.staging.payleor.com/mcp]
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const ROOT = new URL("..", import.meta.url).pathname;
const SOURCE = join(ROOT, "plugins/payleor");
const OUT = join(ROOT, "dist/plugin");
const PRODUCTION_MCP_URL = "https://api.payleor.com/mcp";

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

const mcpUrl = argValue("--mcp-url") ?? PRODUCTION_MCP_URL;
if (!/^https:\/\/[a-z0-9.-]+\/mcp$/.test(mcpUrl)) throw new Error(`Not an MCP endpoint URL: ${mcpUrl}`);

const files: Entry[] = await Promise.all(
  (await listFiles(SOURCE)).map(async (path) => {
    const name = relative(SOURCE, path);
    const text = await readFile(path, "utf8");
    // Only the connector URL changes for a staging build.
    const data = name === "mcp.json" || name === ".mcp.json" ? text.replaceAll(PRODUCTION_MCP_URL, mcpUrl) : text;
    return { name, data: Buffer.from(data, "utf8") };
  }),
);

await mkdir(OUT, { recursive: true });
const suffix = mcpUrl === PRODUCTION_MCP_URL ? "" : `-${new URL(mcpUrl).hostname.split(".")[1] ?? "custom"}`;
await writeFile(join(OUT, `payleor-plugin${suffix}.zip`), zip(files.map((f) => ({ ...f, name: `payleor/${f.name}` }))));
await writeFile(join(OUT, `payleor-plugin-chatgpt${suffix}.zip`), zip(files));
console.log(`Wrote ${files.length} files for ${mcpUrl} to dist/plugin/`);
