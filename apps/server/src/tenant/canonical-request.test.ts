import { expect, it } from "vitest";
import { canonicalRequest } from "./canonical-request";

const domains = { platformDomain: "new.test", storeDomain: "new-store.test", legacyPlatformDomain: "old.test", legacyStoreDomain: "old-store.test" };
it("normalizes only the host while retaining a signed callback's method, query, headers and exact body", async () => {
  const body = '{ "event": "payment", "value": 100 }';
  const input = new Request("https://api.old.test/webhooks/paypal?retry=1", {
    method: "POST", body, headers: { Origin: "https://dash.old.test", "PayPal-Transmission-Sig": "signed-value" },
  });
  const output = canonicalRequest(input, domains);
  expect(output.url).toBe("https://api.new.test/webhooks/paypal?retry=1");
  expect(output.method).toBe("POST");
  expect(output.headers.get("host")).toBe("api.new.test");
  expect(output.headers.get("origin")).toBe("https://dash.old.test");
  expect(output.headers.get("paypal-transmission-sig")).toBe("signed-value");
  expect(await output.text()).toBe(body);
});
it("leaves unrelated custom seller domains untouched", () => {
  const input = new Request("https://seller.example/checkout");
  expect(canonicalRequest(input, domains)).toBe(input);
});
