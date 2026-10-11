import { MAX_IMAGE_BYTES } from "@jendal-workspace/core";
import { describe, expect, it } from "vitest";

import { createHttpImageDownloader } from "./image-downloader";

function fetchReturning(status: number, body: ArrayBuffer, contentType = "image/jpeg"): typeof fetch {
  return async () => new Response(body, { status, headers: { "content-type": contentType } });
}

describe("createHttpImageDownloader", () => {
  it("downloads an image over https", async () => {
    const bytes = new Uint8Array([9, 9]).buffer;
    const downloader = createHttpImageDownloader(fetchReturning(200, bytes));

    const result = await downloader.download("https://cdn.example.com/a.jpg");
    expect(result?.contentType).toBe("image/jpeg");
    expect(new Uint8Array(result!.bytes)).toEqual(new Uint8Array([9, 9]));
  });

  it("refuses non-https URLs without calling fetch", async () => {
    let called = false;
    const downloader = createHttpImageDownloader(async () => {
      called = true;
      return new Response();
    });

    expect(await downloader.download("http://169.254.169.254/latest")).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null on http errors, network failures and oversized bodies", async () => {
    const downloader = createHttpImageDownloader(fetchReturning(404, new ArrayBuffer(1)));
    expect(await downloader.download("https://example.com/a.jpg")).toBeNull();

    const throwing = createHttpImageDownloader(async () => {
      throw new Error("network");
    });
    expect(await throwing.download("https://example.com/a.jpg")).toBeNull();

    const big = createHttpImageDownloader(fetchReturning(200, new ArrayBuffer(MAX_IMAGE_BYTES + 1)));
    expect(await big.download("https://example.com/big.jpg")).toBeNull();
  });
});
