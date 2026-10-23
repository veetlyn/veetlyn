import { describe, expect, it } from "vitest";

import { storeUrl, storeUrlParts } from "./store-url";

describe("storeUrlParts", () => {
  it("uses https and the bare store domain on public hosts", () => {
    expect(storeUrlParts("elysiumjs.com", "admin.elysiumjs.com")).toEqual({ prefix: "https://", suffix: ".elysiumjs.com" });
  });

  it("uses http and keeps the dev port on localhost", () => {
    expect(storeUrlParts("localhost", "dash.localhost:3001")).toEqual({ prefix: "http://", suffix: ".localhost:3001" });
  });

  it("drops the request port when the store domain is public", () => {
    expect(storeUrlParts("platform.site", "dash.platform.test:8443")).toEqual({ prefix: "https://", suffix: ".platform.site" });
  });
});

describe("storeUrl", () => {
  it("joins the slug with the parts", () => {
    expect(storeUrl("acme", { prefix: "https://", suffix: ".platform.site" })).toBe("https://acme.platform.site");
  });
});
