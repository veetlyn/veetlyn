import { expect, it } from "vitest";
import { domainRedirect } from "./domain-redirect";
const domains = { platformDomain: "platform.test", storeDomain: "store.test" };
it.each(["https://store.test/pricing?x=1", "https://www.store.test/pricing?x=1"])("sends the seller domain root %s to the platform site", (url) => {
  const response = domainRedirect(new Request(url), domains);
  expect(response?.status).toBe(307);
  expect(response?.headers.get("location")).toBe("https://platform.test/pricing?x=1");
});
it.each(["https://walk-crew.store.test/", "https://platform.test/", "https://store.test/api/auth/session"])("leaves %s alone", (url) => {
  expect(domainRedirect(new Request(url), domains)).toBeNull();
});
it("never redirects mutation requests", () => {
  expect(domainRedirect(new Request("https://store.test/", { method: "POST", body: "{}" }), domains)).toBeNull();
});
