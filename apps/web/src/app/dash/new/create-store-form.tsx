"use client";

import { suggestStoreSlug } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@jendal-workspace/ui/components/input-group";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { slugStatus } from "@/lib/slug-status";
import { type StoreUrlParts, storeUrl } from "@/lib/store-url";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { trpc } from "@/utils/trpc";

const TONE_CLASS = {
  pending: "text-muted-foreground",
  available: "text-brand-text",
  problem: "text-destructive",
} as const;

export default function CreateStoreForm({ urlParts }: { urlParts: StoreUrlParts }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [typedSlug, setTypedSlug] = useState<string | null>(null);
  // The address follows the name until the merchant edits it.
  const slug = (typedSlug ?? suggestStoreSlug(name)).trim().toLowerCase();
  const debouncedSlug = useDebouncedValue(slug, 300);

  const check = useQuery({
    ...trpc.store.checkSlug.queryOptions({ slug: debouncedSlug }),
    enabled: debouncedSlug.length > 0,
  });
  const create = useMutation(trpc.store.create.mutationOptions({ onSuccess: (store) => router.push(`/${store.slug}`) }));

  const settled = debouncedSlug === slug && !check.isFetching;
  const status = create.error
    ? { tone: "problem" as const, text: create.error.message }
    : slugStatus(slug, settled ? check.data : undefined, (s) => storeUrl(s, urlParts));
  const canSubmit = name.trim().length >= 2 && status?.tone === "available" && !create.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) create.mutate({ name: name.trim(), slug });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 grid gap-6">
      <div className="space-y-2">
        <Label htmlFor="store-name">Store name</Label>
        <Input
          id="store-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            create.reset();
          }}
          required
          minLength={2}
          maxLength={80}
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="store-slug">Store URL</Label>
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>{urlParts.prefix}</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id="store-slug"
            value={typedSlug ?? suggestStoreSlug(name)}
            onChange={(e) => {
              setTypedSlug(e.target.value);
              create.reset();
            }}
            placeholder="acme"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="store-slug-status"
            required
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>{urlParts.suffix}</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        <p id="store-slug-status" aria-live="polite" className={`min-h-5 text-sm ${status ? TONE_CLASS[status.tone] : ""}`}>
          {status?.text}
        </p>
      </div>
      <Button type="submit" disabled={!canSubmit} className="justify-self-start">
        {create.isPending ? "Creating your store…" : "Create store"}
      </Button>
    </form>
  );
}
