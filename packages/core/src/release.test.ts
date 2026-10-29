import { describe, expect, it } from "vitest";
import { releaseResponse } from "./release";

describe("public deployment provenance", () => {
  it("identifies the serving Worker and does not serialize secrets from its bindings", async () => {
    const bindings = {
      RELEASE_SHA: "a".repeat(40), DEPLOY_STAGE: "staging", PUBLIC_ACCESS: "open",
      PLATFORM_NAME: "Platform", PLATFORM_DOMAIN: "staging.example.com", STORE_DOMAIN: "staging.example.app",
      PAYPAL_ENVIRONMENT: "sandbox", BETTER_AUTH_SECRET: "never-public",
    };
    const response = releaseResponse("api", bindings);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = await response.json();
    expect(data).toMatchObject({ service: "api", sha: "a".repeat(40), stage: "staging", publicAccess: "open" });
    expect(data).not.toHaveProperty("BETTER_AUTH_SECRET");
    expect(JSON.stringify(data)).not.toContain("never-public");
  });
});
