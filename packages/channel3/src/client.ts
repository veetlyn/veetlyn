import { type JsonObject, SourceError, type ProductSource } from "@jendal-workspace/core";
import type { z } from "zod";

import { toSourceProduct } from "./map";
import { channel3ProductSchema, lookupResponseSchema, searchResponseSchema } from "./schemas";

export const CHANNEL3_BASE_URL = "https://api.trychannel3.com";

export type Channel3Config = { apiKey: string; baseUrl?: string; fetch?: typeof fetch };

type Channel3Headers = { "x-api-key": string; "content-type"?: string };

export function createChannel3Client(config: Channel3Config): ProductSource {
  const fetchImpl = config.fetch ?? fetch;
  const baseUrl = config.baseUrl ?? CHANNEL3_BASE_URL;

  async function request<S extends z.ZodType>(
    method: "GET" | "POST",
    path: string,
    schema: S,
    body?: JsonObject,
  ): Promise<z.output<S>> {
    const headers: Channel3Headers = { "x-api-key": config.apiKey };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, init);
    } catch {
      throw new SourceError("unavailable", "Channel3 could not be reached");
    }
    // 404 (unknown product) and 422 (not a product page / not a product image) both mean "no match".
    if (response.status === 404 || response.status === 422) {
      throw new SourceError("not_found", "No match found");
    }
    if (!response.ok) throw new SourceError("unavailable", `Channel3 answered ${response.status}`);
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new SourceError("unavailable", "Channel3 returned an unreadable response");
    }
    const result = schema.safeParse(data);
    if (!result.success) throw new SourceError("unavailable", "Channel3 returned an unexpected response shape");
    return result.data;
  }

  return {
    async lookupByUrl(url) {
      const data = await request("POST", "/v1/lookup", lookupResponseSchema, { url });
      return toSourceProduct(data.product);
    },
    async searchByImage({ base64Image, limit }) {
      const data = await request("POST", "/v1/image-search", searchResponseSchema, {
        base64_image: base64Image,
        limit,
        segment: "AUTO",
      });
      return data.products.map(toSourceProduct);
    },
    async getProduct(id) {
      const data = await request("GET", `/v1/products/${encodeURIComponent(id)}`, channel3ProductSchema);
      return toSourceProduct(data);
    },
    async similarProducts({ productId, currency, limit }) {
      const data = await request("POST", "/v1/similar", searchResponseSchema, {
        product_id: productId,
        limit,
        config: { currency },
      });
      return data.products.map(toSourceProduct);
    },
    async searchProducts({ query, currency, limit }) {
      const data = await request("POST", "/v1/search", searchResponseSchema, { query, limit, config: { currency } });
      return data.products.map(toSourceProduct);
    },
  };
}
