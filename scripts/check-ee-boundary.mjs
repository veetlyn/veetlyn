// Fails when AGPL code imports from ee/: the core must run without the commercially licensed folder.
import { execFileSync } from "node:child_process";

let out = "";
try {
  out = execFileSync(
    "git",
    ["grep", "-n", "-I", "-E", String.raw`(from|import\(|require\()\s*["'][^"']*(\bee/|@[a-z-]+/ee\b)`, "--", "apps", "packages", "plugins", "scripts"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
} catch {
  // git grep exits 1 when nothing matches.
  out = "";
}
if (out !== "") {
  console.error(`Code outside ee/ must not import from it:\n${out}`);
  process.exitCode = 1;
}
