import {
  createFakeImageDownloader,
  createFakeImageStore,
  createFakeProductSource,
  createFakeTextCache,
} from "@jendal-workspace/core";

import type { CatalogServices } from "../catalog/service";

export type { CatalogServices } from "../catalog/service";

// The default source is a fake that answers not_found; tests override the pieces they exercise.
export function createTestCatalogServices(overrides: Partial<CatalogServices> = {}): CatalogServices {
  return {
    source: createFakeProductSource(),
    images: createFakeImageStore(),
    imageDownloader: createFakeImageDownloader(),
    textCache: createFakeTextCache(),
    currency: "USD",
    ...overrides,
  };
}
