import { describe, expect, it } from "vitest";

import { siteOriginFor, storeOriginFor } from "./store-origin";

describe("storeOriginFor", () => {
  it("uses https and the store domain", () => {
    expect(storeOriginFor({ storeDomain: "platform.test", dashOrigin: "https://dash.platform.test" })("walk-crew")).toBe(
      "https://walk-crew.platform.test",
    );
  });

  it("uses http and the admin port on localhost", () => {
    expect(storeOriginFor({ storeDomain: "localhost", dashOrigin: "http://dash.localhost:3001" })("walk-crew")).toBe(
      "http://walk-crew.localhost:3001",
    );
  });
});

describe("siteOriginFor", () => {
  it("drops the dash label from the dash origin", () => {
    expect(siteOriginFor("https://dash.platform.test")).toBe("https://platform.test");
    expect(siteOriginFor("https://dash.staging.platform.test")).toBe("https://staging.platform.test");
    expect(siteOriginFor("http://dash.localhost:3001")).toBe("http://localhost:3001");
  });
});
