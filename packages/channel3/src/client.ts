import { SourceError, type ProductSource } from "@jendal-workspace/core";
import type { z } from "zod";

import { toSourceProduct } from "./map";
import { channel3ProductSchema, lookupResponseSchema, searchResponseSchema } from "./schemas";

export const CHANNEL3_BASE_URL = "https://api.trychannel3.com";

export type Channel3Config = { apiKey: string; baseUrl?: string; fetch?: typeof fetch };

function parseWith<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new SourceError("unavailable", "Channel3 returned an unexpected response shape");
  return result.data as z.infer<S>;
}

export function createChannel3Client(config: Channel3Config): ProductSource {
  const fetchImpl = config.fetch ?? fetch;
  const baseUrl = config.baseUrl ?? CHANNEL3_BASE_URL;

  async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          "x-api-key": config.apiKey,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new SourceError("unavailable", "Channel3 could not be reached");
    }
    // 404 (unknown product) and 422 (not a product page / not a product image) both mean "no match".
    if (response.status === 404 || response.status === 422) {
      throw new SourceError("not_found", "No match found");
    }
    if (!response.ok) throw new SourceError("unavailable", `Channel3 answered ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new SourceError("unavailable", "Channel3 returned an unreadable response");
    }
  }

  return {
    async lookupByUrl(url) {
      const data = parseWith(lookupResponseSchema, await request("POST", "/v1/lookup", { url }));
      return toSourceProduct(data.product);
    },
    async searchByImage({ base64Image, limit }) {
      const data = parseWith(
        searchResponseSchema,
        await request("POST", "/v1/image-search", { base64_image: base64Image, limit, segment: "AUTO" }),
      );
      return data.products.map(toSourceProduct);
    },
    async getProduct(id) {
      const data = parseWith(channel3ProductSchema, await request("GET", `/v1/products/${encodeURIComponent(id)}`));
      return toSourceProduct(data);
    },
    async similarProducts({ productId, currency, limit }) {
      const data = parseWith(
        searchResponseSchema,
        await request("POST", "/v1/similar", { product_id: productId, limit, config: { currency } }),
      );
      return data.products.map(toSourceProduct);
    },
    async searchProducts({ query, currency, limit }) {
      const data = parseWith(
        searchResponseSchema,
        await request("POST", "/v1/search", { query, limit, config: { currency } }),
      );
      return data.products.map(toSourceProduct);
    },
  };
}
