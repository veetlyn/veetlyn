// Fails when packages/oss source (or its package manifests) reaches into platform code. The OSS packages build
// standalone: within a package only relative imports inside it, and bare imports of @opmodel/* and public
// libraries, are allowed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const OSS_ROOT = resolve("packages/oss");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx"]);
const IMPORT_PATTERN = /(?:import|export)\s[^;"']*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) entries.push(...walk(path));
    else entries.push(path);
  }
  return entries;
}

const files = readdirSync(OSS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => walk(join(OSS_ROOT, entry.name)));

const violations = [];
for (const file of files) {
  const rel = relative(process.cwd(), file);
  if (file.endsWith("package.json")) {
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    for (const group of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const name of Object.keys(manifest[group] ?? {})) {
        if (name.startsWith("@jendal/")) violations.push(`${rel}: ${group} depends on ${name}`);
      }
    }
    continue;
  }
  const ext = file.slice(file.lastIndexOf("."));
  if (!SOURCE_EXTENSIONS.has(ext)) continue;
  const source = readFileSync(file, "utf8");
  const packageRoot = join(OSS_ROOT, relative(OSS_ROOT, file).split(/[\\/]/)[0]);
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier.startsWith("@jendal/")) {
      violations.push(`${rel}: imports ${specifier}`);
    } else if (specifier.startsWith(".")) {
      const resolved = resolve(dirname(file), specifier);
      if (resolved !== packageRoot && !resolved.startsWith(`${packageRoot}/`)) {
        violations.push(`${rel}: relative import ${specifier} leaves its package`);
      }
    } else if (/^(apps|packages)\//.test(specifier)) {
      violations.push(`${rel}: imports workspace path ${specifier}`);
    }
  }
}

if (violations.length > 0) {
  console.error(`packages/oss must stay standalone; ${violations.length} platform-bound import(s) found:\n${violations.join("\n")}`);
  process.exitCode = 1;
}
