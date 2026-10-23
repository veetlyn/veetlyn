// Fails when tracked source mentions the product name. The name people read comes from PLATFORM_NAME.
import { execFileSync } from "node:child_process";

// Docs, the published plugin, generated files and migrations (history) keep the name.
const KEPT = [/^specs\//, /\.md$/, /^plugins\//, /^LICENSE/, /(^|\/)pnpm-lock\.yaml$/, /\.generated\.ts$/, /(^|\/)src\/env\.ts$/, /\/migrations\/.*\.sql$/];

let out = "";
try {
  out = execFileSync("git", ["grep", "-n", "-I", "-i", ["pay", "leor"].join(""), "--", "."], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  // git grep exits 1 when nothing matches.
  out = "";
}
const hits = out === "" ? [] : out.split("\n").filter((line) => !KEPT.some((rule) => rule.test(line.split(":")[0] ?? "")));
if (hits.length > 0) {
  console.error(`${hits.length} line(s) name the product in source; use platform, PLATFORM_NAME or the domain variables:\n${hits.join("\n")}`);
  process.exitCode = 1;
}
