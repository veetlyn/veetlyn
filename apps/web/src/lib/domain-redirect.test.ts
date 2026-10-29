import { expect, it } from "vitest";
import { domainRedirect } from "./domain-redirect";
const domains = { platformDomain: "new.test", storeDomain: "new-store.test", legacyPlatformDomain: "old.test", legacyStoreDomain: "old-store.test" };
it("redirects an old customer link with its path and query intact", () => {
  const response = domainRedirect(new Request("https://walk-crew.old-store.test/pay/token?ref=old"), domains);
  expect(response?.status).toBe(307);
  expect(response?.headers.get("location")).toBe("https://walk-crew.new-store.test/pay/token?ref=old");
  expect(response?.headers.get("cache-control")).toBe("no-store");
});
it.each(["https://old.test/api/auth/callback/discord?code=abc", "https://old.test/.well-known/oauth-authorization-server/api/auth"])("does not redirect API/discovery request %s", url => {
  expect(domainRedirect(new Request(url), domains)).toBeNull();
});
it("never redirects mutation requests", () => {
  expect(domainRedirect(new Request("https://old.test/api/auth/sign-in/email", { method: "POST", body: "{}" }), domains)).toBeNull();
});
it("routes the seller apex to the canonical platform", () => {
  expect(domainRedirect(new Request("https://new-store.test/"), domains)?.headers.get("location")).toBe("https://new.test/");
});
