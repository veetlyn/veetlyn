import { describe, expect, it } from "vitest";
import { canonicalLegacyHost } from "./legacy-host";

const domains = { platformDomain: "new.test", storeDomain: "new-store.test", legacyPlatformDomain: "old.test", legacyStoreDomain: "old-store.test" };
describe("domain cutover compatibility", () => {
  it.each([
    ["old.test", "new.test"], ["www.old.test", "www.new.test"],
    ["dash.old.test", "dash.new.test"], ["admin.old.test", "admin.new.test"],
    ["api.old.test", "api.new.test"], ["walk-crew.old-store.test", "walk-crew.new-store.test"],
  ])("maps only configured legacy host %s to %s", (host, canonical) => {
    expect(canonicalLegacyHost(host, domains)).toBe(canonical);
  });
  it.each(["old.test.evil.test", "evilold.test", "unknown.old.test", "new.test", "old-store.test", "a.b.old-store.test"])('does not rewrite %s', host => {
    expect(canonicalLegacyHost(host, domains)).toBeNull();
  });
  it("keeps staging slugs within their own stage", () => {
    const staged = { platformDomain: "staging.new.test", storeDomain: "staging.new-store.test", legacyPlatformDomain: "staging.old.test", legacyStoreDomain: "staging.old-store.test" };
    expect(canonicalLegacyHost("walk-crew.staging.old-store.test", staged)).toBe("walk-crew.staging.new-store.test");
    expect(canonicalLegacyHost("walk-crew.old-store.test", staged)).toBeNull();
  });
});
