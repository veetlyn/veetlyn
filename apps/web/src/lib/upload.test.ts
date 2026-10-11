import { describe, expect, it } from "vitest";
import { uploadToPresignedUrl, type UploadRequest } from "./upload";

function progressEvent(loaded: number, total: number, lengthComputable: boolean) {
  return Object.assign(new Event("progress"), { loaded, total, lengthComputable });
}

class FakeXhr implements UploadRequest {
  static last: FakeXhr | null = null;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = undefined;
  status = 0;
  aborted = false;
  upload: UploadRequest["upload"] = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  respond(status: number) {
    this.status = status;
    this.onload?.();
  }
}

function start(signal?: AbortSignal) {
  const file = new File(["hello"], "brand.pdf", { type: "application/pdf" });
  const progress: number[] = [];
  const done = uploadToPresignedUrl(
    {
      url: "https://files.test/key?op=put",
      headers: { "content-type": "application/pdf" },
      file,
      onProgress: (fraction) => progress.push(fraction),
      signal,
    },
    FakeXhr,
  );
  const xhr = FakeXhr.last;
  if (!xhr) throw new Error("no request was made");
  return { done, xhr, file, progress };
}

describe("uploadToPresignedUrl", () => {
  it("PUTs the file with exactly the given headers and resolves on 2xx", async () => {
    const { done, xhr, file } = start();
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe("https://files.test/key?op=put");
    expect(xhr.headers).toEqual({ "content-type": "application/pdf" });
    expect(xhr.body).toBe(file);
    xhr.respond(200);
    await expect(done).resolves.toBeUndefined();
  });

  it("reports progress as a fraction of the total", async () => {
    const { done, xhr, progress } = start();
    xhr.upload.onprogress?.(progressEvent(25, 100, true));
    xhr.upload.onprogress?.(progressEvent(50, 0, false));
    xhr.upload.onprogress?.(progressEvent(100, 100, true));
    xhr.respond(204);
    await done;
    expect(progress).toEqual([0.25, 1]);
  });

  it("rejects when the storage answers with an error status", async () => {
    const { done, xhr } = start();
    xhr.respond(403);
    await expect(done).rejects.toThrow("The upload failed. Try again.");
  });

  it("rejects on a network error or a timeout", async () => {
    const first = start();
    first.xhr.onerror?.();
    await expect(first.done).rejects.toThrow("The upload failed. Try again.");
    const second = start();
    second.xhr.ontimeout?.();
    await expect(second.done).rejects.toThrow("The upload failed. Try again.");
  });

  it("aborts the request when the signal fires", async () => {
    const controller = new AbortController();
    const { done, xhr } = start(controller.signal);
    controller.abort();
    expect(xhr.aborted).toBe(true);
    await expect(done).rejects.toThrow("The upload failed. Try again.");
  });

  it("does not send anything when the signal has already fired", async () => {
    const controller = new AbortController();
    controller.abort();
    const { done, xhr } = start(controller.signal);
    expect(xhr.body).toBeUndefined();
    await expect(done).rejects.toThrow("The upload failed. Try again.");
  });
});
