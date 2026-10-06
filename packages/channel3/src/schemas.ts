import { z } from "zod";

const priceSchema = z.object({
  price: z.number(),
  compare_at_price: z.number().nullable().optional(),
  currency: z.string(),
});

const offerSchema = z.object({
  url: z.string(),
  domain: z.string(),
  price: priceSchema,
  availability: z.enum(["InStock", "OutOfStock"]).nullable(),
});

const imageSchema = z.object({
  url: z.string(),
  cleaned_url: z.string().nullable().optional(),
  is_main_image: z.boolean().optional(),
  alt_text: z.string().nullable().optional(),
});

const variantOptionSchema = z.object({
  name: z.string(),
  values: z.array(z.object({ label: z.string(), exists: z.boolean() })),
});

export const channel3ProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  brands: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  images: z.array(imageSchema).default([]),
  category: z.object({ slug: z.string(), title: z.string() }).nullable().optional(),
  variants: z.object({ options: z.array(variantOptionSchema) }).nullable().optional(),
  offers: z.array(offerSchema).default([]),
});

export const lookupResponseSchema = z.object({ product: channel3ProductSchema });

export const searchResponseSchema = z.object({ products: z.array(channel3ProductSchema) });
