import { describe, expect, it } from "vitest";

import { sellerHost, sellerHostWildcard } from "./seller-host";

describe("seller hosts", () => {
  it("puts production sellers under the store domain and staging sellers one label under the zone", () => {
    expect(sellerHost("acme", "stores.test")).toBe("acme.stores.test");
    expect(sellerHost("acme", "localhost")).toBe("acme.localhost");
    expect(sellerHost("acme", "staging.stores.test")).toBe("acme-staging.stores.test");
  });

  it("covers every seller of the stage with one CSP host-source", () => {
    expect(sellerHostWildcard("stores.test")).toBe("*.stores.test");
    expect(sellerHostWildcard("staging.stores.test")).toBe("*.stores.test");
  });
});
