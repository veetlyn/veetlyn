import { describe, expect, it } from "vitest";

import { platformOrigins } from "./platform-url";

describe("platformOrigins", () => {
  it("uses http and keeps the port on local stages", () => {
    expect(platformOrigins("localhost", "dash.localhost:3001")).toEqual({
      site: "http://localhost:3001",
      dash: "http://dash.localhost:3001",
    });
  });

  it("uses https without a port on deployed hosts", () => {
    expect(platformOrigins("platform.test", "platform.test")).toEqual({
      site: "https://platform.test",
      dash: "https://dash.platform.test",
    });
    expect(platformOrigins("elysiumjs.com", "dash.elysiumjs.com:443")).toEqual({
      site: "https://elysiumjs.com",
      dash: "https://dash.elysiumjs.com",
    });
  });
});
