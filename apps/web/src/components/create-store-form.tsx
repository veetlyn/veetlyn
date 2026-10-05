"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@jendal-workspace/ui/components/input-group";
import { Label } from "@jendal-workspace/ui/components/label";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { type StoreUrlParts, storeUrl } from "@/lib/store-url";

export default function CreateStoreForm({
  organizationId,
  urlParts,
  onCreated,
}: {
  organizationId: string;
  urlParts: StoreUrlParts;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [pending, setPending] = useState(false);
  const preview = slug.trim().toLowerCase();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const { error } = await authClient.organization.createTeam({ name, slug, organizationId });
    setPending(false);
    if (error) {
      toast.error(error.message ?? "Could not create the store.");
      return;
    }
    setName("");
    setSlug("");
    onCreated();
  }

  const nameId = `store-name-${organizationId}`;
  const slugId = `store-slug-${organizationId}`;
  const previewId = `store-url-preview-${organizationId}`;

  return (
    <form onSubmit={handleSubmit} className="grid gap-3">
      <div className="space-y-2">
        <Label htmlFor={nameId}>Store name</Label>
        <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={slugId}>Store URL</Label>
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>{urlParts.prefix}</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id={slugId}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="acme"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={preview ? previewId : undefined}
            required
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>{urlParts.suffix}</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        {preview ? (
          <p id={previewId} className="text-sm text-muted-foreground">
            Your store will be at {storeUrl(preview, urlParts)}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="justify-self-start">
        Create store
      </Button>
    </form>
  );
}
