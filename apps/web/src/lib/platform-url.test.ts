import { describe, expect, it } from "vitest";

import { platformOrigins } from "./platform-url";

describe("platformOrigins", () => {
  it("uses http and keeps the port on local stages", () => {
    expect(platformOrigins("localhost", "admin.localhost:3001")).toEqual({
      site: "http://localhost:3001",
      admin: "http://admin.localhost:3001",
    });
  });

  it("uses https without a port on deployed and tunnel hosts", () => {
    expect(platformOrigins("payleor.app", "payleor.app")).toEqual({
      site: "https://payleor.app",
      admin: "https://admin.payleor.app",
    });
    expect(platformOrigins("elysiumjs.com", "admin.elysiumjs.com:443")).toEqual({
      site: "https://elysiumjs.com",
      admin: "https://admin.elysiumjs.com",
    });
  });
});
