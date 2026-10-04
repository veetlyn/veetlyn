"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export default function CreateStoreForm({
  organizationId,
  onCreated,
}: {
  organizationId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [pending, setPending] = useState(false);

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

  return (
    <form onSubmit={handleSubmit} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <div className="space-y-2">
        <Label htmlFor={`store-name-${organizationId}`}>Store name</Label>
        <Input
          id={`store-name-${organizationId}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`store-slug-${organizationId}`}>Store address</Label>
        <Input
          id={`store-slug-${organizationId}`}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="acme"
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        Create store
      </Button>
    </form>
  );
}
