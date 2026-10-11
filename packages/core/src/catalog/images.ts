export const MAX_IMAGE_BYTES = 5_000_000;

const IMAGE_CONTENT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
} satisfies Record<string, string>;

const EXTENSION_BY_IMAGE_CONTENT_TYPE = new Map(Object.entries(IMAGE_CONTENT_TYPES));

// SVG is excluded on purpose: it can carry scripts, and we serve these files back to browsers.
export function imageExtensionFor(contentType: string | null): string | null {
  return contentType ? (EXTENSION_BY_IMAGE_CONTENT_TYPE.get(contentType.toLowerCase()) ?? null) : null;
}

export function newProductImageKey(storeId: string, extension: string): string {
  return `stores/${storeId}/images/${crypto.randomUUID()}.${extension}`;
}

export function isProductImageKeyOf(storeId: string, key: string): boolean {
  return key.startsWith(`stores/${storeId}/images/`);
}

export type StoredImage = { bytes: ArrayBuffer; contentType: string };

export interface ProductImageStore {
  put(key: string, bytes: ArrayBuffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredImage | null>;
  has(key: string): Promise<boolean>;
}

export interface ImageDownloader {
  download(url: string): Promise<StoredImage | null>;
}

export interface TextCache {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}

// Chunked because String.fromCharCode(...bytes) overflows the call stack on large images.
export function encodeBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < view.length; offset += chunkSize) {
    binary += String.fromCharCode(...view.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
