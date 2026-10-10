import { describe, expect, it } from "vitest";

import { storeOriginFor } from "./store-origin";

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
