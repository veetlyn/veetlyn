import { describe, expect, it } from "vitest";

import { encodeBase64, imageExtensionFor, isProductImageKeyOf, newProductImageKey } from "./images";

describe("imageExtensionFor", () => {
  it("maps the supported types and rejects the rest", () => {
    expect(imageExtensionFor("image/jpeg")).toBe("jpg");
    expect(imageExtensionFor("image/png")).toBe("png");
    expect(imageExtensionFor("image/webp")).toBe("webp");
    expect(imageExtensionFor("image/gif")).toBe("gif");
    expect(imageExtensionFor("image/avif")).toBe("avif");
    expect(imageExtensionFor("image/svg+xml")).toBeNull();
    expect(imageExtensionFor(null)).toBeNull();
  });
});

describe("product image keys", () => {
  it("builds keys under the store's image prefix", () => {
    const key = newProductImageKey("store-1", "png");

    expect(key).toMatch(/^stores\/store-1\/images\/[0-9a-f-]{36}\.png$/);
    expect(isProductImageKeyOf("store-1", key)).toBe(true);
    expect(isProductImageKeyOf("store-2", key)).toBe(false);
    expect(isProductImageKeyOf("store-1", "other/key.png")).toBe(false);
  });
});

describe("encodeBase64", () => {
  it("encodes bytes without a data-URI prefix", () => {
    expect(encodeBase64(new Uint8Array(new TextEncoder().encode("hi")).buffer)).toBe("aGk=");
  });

  it("encodes buffers larger than one chunk", () => {
    const bytes = new Uint8Array(100_000).fill(97);
    expect(atob(encodeBase64(bytes.buffer))).toHaveLength(100_000);
  });
});
