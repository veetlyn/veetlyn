import { MAX_IMAGE_BYTES, type ImageDownloader } from "@jendal-workspace/core";

const FETCH_TIMEOUT_MS = 10_000;

export function createHttpImageDownloader(fetchImpl: typeof fetch = fetch): ImageDownloader {
  return {
    async download(url) {
      // https only: the downloader runs server-side, so plain http would open SSRF to link-local targets.
      if (!url.startsWith("https://")) return null;
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
        const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
        return { bytes, contentType };
      } catch {
        return null;
      }
    },
  };
}
