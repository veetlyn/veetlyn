import { SourceError } from "@jendal-workspace/core";
import { describe, expect, it } from "vitest";

import { CHANNEL3_BASE_URL, createChannel3Client } from "./client";

const productJson = {
  id: "c3-1",
  title: "Trail Runner",
  description: "A shoe.",
  brands: [{ id: "b1", name: "Acme" }],
  images: [
    { url: "https://cdn.example.com/front.jpg", cleaned_url: "https://cdn.example.com/front-clean.png", is_main_image: true, alt_text: "Front" },
  ],
  category: { slug: "running-shoes", title: "Running shoes", has_children: false },
  variants: {
    options: [
      { name: "Size", values: [{ label: "M", exists: true, available: null, thumbnail_url: null, product_id: null }] },
    ],
    selected: [],
  },
  offers: [
    {
      url: "https://shop.example.com/buy",
      domain: "shop.example.com",
      price: { price: 129.99, compare_at_price: 149.99, currency: "USD" },
      availability: "InStock",
      max_commission_rate: 0,
      condition: "new",
      dimensions: null,
    },
    {
      url: "https://other.example.com/buy",
      domain: "other.example.com",
      price: { price: 119, compare_at_price: null, currency: "USD" },
      availability: "OutOfStock",
      max_commission_rate: 0,
      condition: null,
      dimensions: null,
    },
  ],
  structured_attributes: {},
};

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("createChannel3Client", () => {
  it("posts the lookup with the API key and maps the product", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { product: productJson });
    const client = createChannel3Client({ apiKey: "test-key", fetch: fetchImpl });

    const product = await client.lookupByUrl("https://shop.example.com/product/1");

    expect(calls).toEqual([
      {
        url: `${CHANNEL3_BASE_URL}/v1/lookup`,
        init: {
          method: "POST",
          headers: { "x-api-key": "test-key", "content-type": "application/json" },
          body: JSON.stringify({ url: "https://shop.example.com/product/1" }),
        },
      },
    ]);
    expect(product).toEqual({
      id: "c3-1",
      title: "Trail Runner",
      description: "A shoe.",
      brands: ["Acme"],
      images: [
        { url: "https://cdn.example.com/front.jpg", cleanedUrl: "https://cdn.example.com/front-clean.png", altText: "Front", isMain: true },
      ],
      category: "Running shoes",
      variantOptions: [{ name: "Size", values: [{ label: "M", exists: true }] }],
      offers: [
        { retailer: "shop.example.com", price: 129.99, currency: "USD", inStock: true },
        { retailer: "other.example.com", price: 119, currency: "USD", inStock: false },
      ],
    });
  });

  it.each([404, 422])("maps a %d lookup answer to not_found", async (status) => {
    const { fetchImpl } = fakeFetch(status, { detail: "Product not found" });
    const client = createChannel3Client({ apiKey: "test-key", fetch: fetchImpl });

    await expect(client.lookupByUrl("https://example.com")).rejects.toMatchObject({
      name: "SourceError",
      kind: "not_found",
    });
  });

  it.each([401, 402, 500, 504])("maps a %d answer to unavailable", async (status) => {
    const { fetchImpl } = fakeFetch(status, { detail: "error" });
    const client = createChannel3Client({ apiKey: "test-key", fetch: fetchImpl });

    await expect(client.lookupByUrl("https://example.com")).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("maps network failures and unexpected shapes to unavailable", async () => {
    const throwing = (async () => {
      throw new Error("socket hangup");
    }) as typeof fetch;
    await expect(createChannel3Client({ apiKey: "k", fetch: throwing }).lookupByUrl("https://example.com")).rejects.toMatchObject(
      { kind: "unavailable" },
    );

    const { fetchImpl } = fakeFetch(200, { product: { title: "No id" } });
    await expect(
      createChannel3Client({ apiKey: "k", fetch: fetchImpl }).lookupByUrl("https://example.com"),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("searches by base64 image with a limit and AUTO segmentation", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { products: [productJson], next_page_token: null });
    const client = createChannel3Client({ apiKey: "test-key", fetch: fetchImpl });

    const products = await client.searchByImage({ base64Image: "aGk=", limit: 10 });

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ base64_image: "aGk=", limit: 10, segment: "AUTO" });
    expect(calls[0]?.url).toBe(`${CHANNEL3_BASE_URL}/v1/image-search`);
    expect(products).toHaveLength(1);
    expect(products[0]?.id).toBe("c3-1");
  });

  it("gets a product by ID with a GET", async () => {
    const { fetchImpl, calls } = fakeFetch(200, productJson);
    const client = createChannel3Client({ apiKey: "test-key", fetch: fetchImpl });

    const product = await client.getProduct("c3-1");

    expect(calls[0]?.url).toBe(`${CHANNEL3_BASE_URL}/v1/products/c3-1`);
    expect(calls[0]?.init.method).toBe("GET");
    expect(product.title).toBe("Trail Runner");
  });

  it("finds similar products with the requested currency", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { products: [], next_page_token: null });
    const client = createChannel3Client({ apiKey: "test-key", fetch: fetchImpl });

    await client.similarProducts({ productId: "c3-1", currency: "EUR", limit: 30 });

    expect(calls[0]?.url).toBe(`${CHANNEL3_BASE_URL}/v1/similar`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      product_id: "c3-1",
      limit: 30,
      config: { currency: "EUR" },
    });
  });

  it("searches by text with the requested currency", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { products: [], next_page_token: null });
    const client = createChannel3Client({ apiKey: "test-key", fetch: fetchImpl });

    await client.searchProducts({ query: "Acme Trail Runner", currency: "USD", limit: 30 });

    expect(calls[0]?.url).toBe(`${CHANNEL3_BASE_URL}/v1/search`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      query: "Acme Trail Runner",
      limit: 30,
      config: { currency: "USD" },
    });
  });

  it("throws a typed SourceError", async () => {
    const { fetchImpl } = fakeFetch(500, {});
    const client = createChannel3Client({ apiKey: "k", fetch: fetchImpl });

    await expect(client.lookupByUrl("https://example.com")).rejects.toBeInstanceOf(SourceError);
  });
});
