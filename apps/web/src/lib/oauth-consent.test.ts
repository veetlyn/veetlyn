import { describe, expect, it } from "vitest";

import { consentHost } from "./oauth-consent";

describe("consentHost", () => {
  // The consent screen's one trustworthy fact: a client named "Payleor Sync" still shows where tokens go.
  it("names the host tokens are sent to, and nothing for an address that is not https", () => {
    expect(consentHost("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(consentHost("https://evil.example:8443/cb?x=1")).toBe("evil.example:8443");
    expect(consentHost("javascript:alert(1)")).toBeNull();
    expect(consentHost("http://phish.example/cb")).toBeNull();
    expect(consentHost("not a url")).toBeNull();
  });
});
