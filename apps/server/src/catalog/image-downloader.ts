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
        const bytes = await readCapped(response, MAX_IMAGE_BYTES);
        if (!bytes || bytes.byteLength === 0) return null;
        const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
        return { bytes, contentType };
      } catch {
        return null;
      }
    },
  };
}

// Reads the body until it passes the cap, so a huge image never sits whole in memory.
async function readCapped(response: Response, cap: number): Promise<ArrayBuffer | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}
