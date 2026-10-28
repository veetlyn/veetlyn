import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

if (existsSync(".env.test.local")) {
  process.loadEnvFile(".env.test.local");
}

export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    "next/link": "vinext/shims/link",
  } },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/oss/*/src/**/*.test.ts",
      "packages/infra/*.test.ts",
      "apps/server/src/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
    ],
    passWithNoTests: true,
    globalSetup: ["./packages/db/src/testing/global-setup.ts"],
    // DB tests share one database, so test files run one at a time.
    fileParallelism: false,
    // Auth tests hash several passwords with scrypt per test, which can exceed 5s on a loaded machine.
    testTimeout: 20_000,
  },
});
