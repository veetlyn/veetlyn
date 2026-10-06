"use client";

import {
  MAX_IMAGES,
  MAX_VARIANTS,
  encodeBase64,
  validateProductDraft,
  type ProductPrefill,
  type SourceMatch,
} from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";

import { productImageUrl } from "@/lib/image-url";
import {
  type ImageFormState,
  type ProductFormState,
  type VariantFormState,
  emptyProductForm,
  productFormToDraft,
} from "@/lib/product-form-state";
import { trpc } from "@/utils/trpc";

type Props = {
  storeSlug: string;
  productId?: string;
  initial?: ProductFormState;
  // The Channel3 start section shows only when creating (no productId).
};

async function uploadImage(storeSlug: string, file: File): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`/api/catalog/images?storeSlug=${encodeURIComponent(storeSlug)}`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new Error("The image upload failed. Try again.");
  return ((await response.json()) as { key: string }).key;
}

export default function ProductForm({ storeSlug, productId, initial }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<ProductFormState>(() => initial ?? emptyProductForm());
  const [link, setLink] = useState("");
  const [matches, setMatches] = useState<SourceMatch[]>([]);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const create = useMutation(trpc.catalog.create.mutationOptions());
  const update = useMutation(trpc.catalog.update.mutationOptions());
  const lookup = useMutation(trpc.catalog.lookupFromUrl.mutationOptions());
  const photoLookup = useMutation(trpc.catalog.lookupFromPhoto.mutationOptions());
  const prefillMatch = useMutation(trpc.catalog.prefillFromMatch.mutationOptions());

  function patch(patch: Partial<ProductFormState>) {
    setForm((current) => ({ ...current, ...patch }));
    setSubmitMessage(null);
  }

  function patchVariant(index: number, patchVariant: Partial<VariantFormState>) {
    patch({ variants: form.variants.map((v, i) => (i === index ? { ...v, ...patchVariant } : v)) });
  }

  function applyPrefill(prefill: ProductPrefill) {
    patch({
      title: prefill.title,
      description: prefill.description,
      brand: prefill.brand,
      category: prefill.category,
      channel3ProductId: prefill.channel3ProductId,
      // Prices and stock are never pre-filled (sponsor spec §3.1); the merchant sets them.
      variants: prefill.variants.map((variant) => ({ options: variant.options, sku: "", price: "", stock: "" })),
      images: prefill.images.map((image) => ({ sourceUrl: image.sourceUrl, alt: image.alt, previewUrl: image.sourceUrl })),
      rightsConfirmed: false,
    });
    setMatches([]);
    setLookupMessage("Details imported. Set your prices and confirm the rights below.");
  }

  async function handleLookup() {
    setLookupMessage(null);
    setLookupError(null);
    let result;
    try {
      result = await lookup.mutateAsync({ storeSlug, url: link.trim() });
    } catch {
      setLookupError("The product lookup failed. Try again, or fill in the details yourself.");
      return;
    }
    if (result.status === "ok") {
      applyPrefill(result.prefill);
      if (result.alternatives.length > 0) setMatches(result.alternatives);
    } else if (result.status === "no_match") {
      setLookupMessage("We couldn't find a product for that link. Fill in the details yourself.");
    } else {
      setLookupMessage("Product lookup isn't available right now. Fill in the details yourself.");
    }
  }

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLookupMessage(null);
    setLookupError(null);
    let result;
    try {
      result = await photoLookup.mutateAsync({ storeSlug, base64Image: encodeBase64(await file.arrayBuffer()) });
    } catch {
      setLookupError("The photo search failed. Try again, or fill in the details yourself.");
      return;
    }
    if (result.status === "ok") {
      setMatches(result.matches);
      setLookupMessage("Pick the matching product to import its details.");
    } else if (result.status === "no_match") {
      setLookupMessage("We couldn't match that photo. Fill in the details yourself.");
    } else {
      setLookupMessage("Photo search isn't available right now. Fill in the details yourself.");
    }
  }

  async function handlePickMatch(productId: string) {
    setLookupError(null);
    let result;
    try {
      result = await prefillMatch.mutateAsync({ storeSlug, productId });
    } catch {
      setLookupError("That match could not be loaded. Try again, or fill in the details yourself.");
      return;
    }
    if (result.status === "ok") applyPrefill(result.prefill);
    else setLookupMessage("That match could not be loaded. Fill in the details yourself.");
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    for (const file of files) {
      try {
        const key = await uploadImage(storeSlug, file);
        // Functional update: `form` in this closure is stale after the first file of a multi-file upload.
        setForm((current) => ({
          ...current,
          images: [...current.images, { imageKey: key, alt: "", previewUrl: productImageUrl(key) }],
        }));
        setSubmitMessage(null);
      } catch (error) {
        setSubmitMessage(error instanceof Error ? error.message : "The image upload failed. Try again.");
      }
    }
  }

  const needsRights = form.channel3ProductId !== null;
  const saving = create.isPending || update.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (needsRights && !form.rightsConfirmed) {
      setSubmitMessage("Confirm you have the right to use the imported details and images.");
      return;
    }
    const draft = productFormToDraft(form);
    const problems = validateProductDraft(draft);
    if (problems.length > 0) {
      setSubmitMessage(problems[0]!.message);
      return;
    }
    const onError = (error: { message: string }) => setSubmitMessage(error.message);
    const onSuccess = () => router.push(`/${storeSlug}/products`);
    if (productId) update.mutate({ storeSlug, id: productId, ...draft }, { onSuccess, onError });
    else create.mutate({ storeSlug, ...draft }, { onSuccess, onError });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-8">
      {!productId && (
        <section aria-labelledby="import-heading" className="grid gap-3 border p-4">
          <h2 id="import-heading" className="font-medium">
            Start from a link or a photo
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid min-w-64 flex-1 gap-1">
              <Label htmlFor="product-link">Product link</Label>
              <Input
                id="product-link"
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://shop.example.com/product/…"
              />
            </div>
            <Button type="button" variant="outline" onClick={handleLookup} disabled={!link.trim() || lookup.isPending}>
              {lookup.isPending ? "Looking up…" : "Look up"}
            </Button>
            <Button type="button" variant="outline" onClick={() => photoInput.current?.click()} disabled={photoLookup.isPending}>
              {photoLookup.isPending ? "Searching…" : "Use a photo"}
            </Button>
            <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
          </div>
          {lookupMessage && <p className="text-sm text-muted-foreground">{lookupMessage}</p>}
          {lookupError && (
            <p role="alert" className="text-sm text-destructive">
              {lookupError}
            </p>
          )}
          {matches.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {matches.map((match) => (
                <li key={match.productId} className="flex items-center gap-3 border p-2">
                  {match.imageUrl && <img src={match.imageUrl} alt="" className="size-12 object-cover" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{match.title}</p>
                    {match.brand && <p className="text-sm text-muted-foreground">{match.brand}</p>}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => handlePickMatch(match.productId)}>
                    Use this match
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="grid gap-4">
        <div className="grid gap-1">
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={form.title} onChange={(e) => patch({ title: e.target.value })} maxLength={200} required />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" value={form.description} onChange={(e) => patch({ description: e.target.value })} rows={4} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="brand">Brand</Label>
            <Input id="brand" value={form.brand} onChange={(e) => patch({ brand: e.target.value })} maxLength={120} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="category">Category</Label>
            <Input id="category" value={form.category} onChange={(e) => patch({ category: e.target.value })} maxLength={120} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={form.chargeTax} onCheckedChange={(checked) => patch({ chargeTax: checked === true })} />
          Charge tax on this product
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.requiresShipping}
            onCheckedChange={(checked) => patch({ requiresShipping: checked === true })}
          />
          This product needs shipping
        </label>
      </section>

      <section aria-labelledby="variants-heading" className="grid gap-3">
        <h2 id="variants-heading" className="font-medium">
          Variants
        </h2>
        {form.variants.map((variant, index) => (
          <div key={index} className="grid gap-2 border p-3 sm:grid-cols-[1fr_1fr_7rem_7rem_auto] sm:items-end">
            <div className="grid gap-1">
              <Label htmlFor={`variant-options-${index}`}>Options</Label>
              <Input
                id={`variant-options-${index}`}
                value={variant.options.map((option) => `${option.name}: ${option.value}`).join(" / ")}
                onChange={(e) =>
                  patchVariant(index, {
                    options: e.target.value
                      .split("/")
                      .map((part) => part.trim())
                      .filter(Boolean)
                      .map((part) => {
                        const [name, ...rest] = part.split(":");
                        return { name: (name ?? "").trim(), value: rest.join(":").trim() };
                      }),
                  })
                }
                placeholder="Color: Red / Size: M"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`variant-sku-${index}`}>SKU</Label>
              <Input
                id={`variant-sku-${index}`}
                value={variant.sku}
                onChange={(e) => patchVariant(index, { sku: e.target.value })}
                maxLength={64}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`variant-price-${index}`}>Price (USD)</Label>
              <Input
                id={`variant-price-${index}`}
                value={variant.price}
                onChange={(e) => patchVariant(index, { price: e.target.value })}
                inputMode="decimal"
                placeholder="42.00"
                required
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`variant-stock-${index}`}>Stock</Label>
              <Input
                id={`variant-stock-${index}`}
                value={variant.stock}
                onChange={(e) => patchVariant(index, { stock: e.target.value })}
                inputMode="numeric"
                placeholder="0"
                required
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => patch({ variants: form.variants.filter((_, i) => i !== index) })}
              disabled={form.variants.length <= 1}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          disabled={form.variants.length >= MAX_VARIANTS}
          onClick={() => patch({ variants: [...form.variants, { options: [], sku: "", price: "", stock: "" }] })}
        >
          Add variant
        </Button>
      </section>

      <section aria-labelledby="images-heading" className="grid gap-3">
        <h2 id="images-heading" className="font-medium">
          Images
        </h2>
        {form.images.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {form.images.map((image: ImageFormState, index: number) => (
              <li key={`${image.previewUrl}-${index}`} className="grid gap-1">
                <img src={image.previewUrl} alt={image.alt} className="aspect-square w-full border object-cover" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => patch({ images: form.images.filter((_, i) => i !== index) })}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            multiple
            onChange={handleUpload}
            disabled={form.images.length >= MAX_IMAGES}
          />
          <p className="mt-1 text-sm text-muted-foreground">Up to {MAX_IMAGES} images, 5 MB each.</p>
        </div>
      </section>

      {needsRights && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.rightsConfirmed}
            onCheckedChange={(checked) => patch({ rightsConfirmed: checked === true })}
          />
          I have the right to use the imported product details and images.
        </label>
      )}

      {submitMessage && (
        <p role="alert" className="text-sm text-destructive">
          {submitMessage}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : productId ? "Save changes" : "Create product"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(`/${storeSlug}/products`)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
