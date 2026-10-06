import { describe, expect, it } from "vitest";

import { productImageUrl } from "./image-url";

describe("productImageUrl", () => {
  it("points at the api worker's image route (forwarded by the web worker)", () => {
    expect(productImageUrl("stores/s1/images/a.png")).toBe("/api/catalog/images/stores/s1/images/a.png");
  });
});
