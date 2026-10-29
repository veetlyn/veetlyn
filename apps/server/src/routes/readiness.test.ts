import { expect, it } from "vitest";
import { createReadinessRoute } from "./readiness";

it("waits for the database probe before accepting traffic", async () => {
  let complete: (() => void) | undefined;
  const database = new Promise<void>((resolve) => { complete = resolve; });
  const response = createReadinessRoute(() => database).request("/health/ready");
  complete?.();
  const result = await response;
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ ready: true });
  expect(result.headers.get("cache-control")).toBe("no-store");
});
it("rejects readiness without exposing database credentials on query failure", async () => {
  const app = createReadinessRoute(async () => { throw new Error("postgres://private-credential"); });
  const response = await app.request("/health/ready");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ready: false });
});
