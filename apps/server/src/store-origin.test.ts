import { describe, expect, it } from "vitest";

import { siteOriginFor, storeOriginFor } from "./store-origin";

describe("storeOriginFor", () => {
  it("uses https and the store domain", () => {
    expect(storeOriginFor({ storeDomain: "payleor.app", adminOrigin: "https://admin.payleor.com" })("walk-crew")).toBe(
      "https://walk-crew.payleor.app",
    );
  });

  it("uses http and the admin port on localhost", () => {
    expect(storeOriginFor({ storeDomain: "localhost", adminOrigin: "http://admin.localhost:3001" })("walk-crew")).toBe(
      "http://walk-crew.localhost:3001",
    );
  });
});

describe("siteOriginFor", () => {
  it("drops the dash label from the dash origin", () => {
    expect(siteOriginFor("https://dash.payleor.com")).toBe("https://payleor.com");
    expect(siteOriginFor("https://dash.staging.payleor.com")).toBe("https://staging.payleor.com");
    expect(siteOriginFor("http://dash.localhost:3001")).toBe("http://localhost:3001");
  });
});
