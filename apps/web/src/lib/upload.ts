// The subset of XMLHttpRequest the upload uses, so tests can pass a fake (the web tests run in node).
type ProgressHandler = ((event: ProgressEvent) => void) | null;

export type UploadRequest = Pick<XMLHttpRequest, "open" | "setRequestHeader" | "send" | "abort" | "status"> & {
  upload: { onprogress: ProgressHandler };
  onload: ProgressHandler;
  onerror: ProgressHandler;
  onabort: ProgressHandler;
  ontimeout: ProgressHandler;
};

const UPLOAD_FAILED = "The upload failed. Try again.";

// fetch cannot report upload progress, so the PUT to the presigned URL uses XMLHttpRequest.
export function uploadToPresignedUrl(
  input: {
    url: string;
    headers: Record<string, string>;
    file: File;
    onProgress: (fraction: number) => void;
    signal?: AbortSignal;
  },
  Request: new () => UploadRequest = XMLHttpRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new Request();
    const fail = () => {
      input.signal?.removeEventListener("abort", onAbort);
      reject(new Error(UPLOAD_FAILED));
    };
    const onAbort = () => xhr.abort();

    xhr.open("PUT", input.url);
    for (const [name, value] of Object.entries(input.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) input.onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return fail();
      input.signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    xhr.onerror = fail;
    xhr.onabort = fail;
    xhr.ontimeout = fail;

    if (input.signal?.aborted) return fail();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(input.file);
  });
}
