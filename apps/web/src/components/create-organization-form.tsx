"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export default function CreateOrganizationForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    // The organization slug never appears in a URL, so a random one saves the merchant a question.
    const { error } = await authClient.organization.create({
      name,
      slug: `org-${crypto.randomUUID().slice(0, 8)}`,
    });
    setPending(false);
    if (error) {
      toast.error(error.message ?? "Could not create your merchant account.");
      return;
    }
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border p-4">
      <h2 className="font-medium">Create your merchant account</h2>
      <div className="space-y-2">
        <Label htmlFor="organization-name">Business name</Label>
        <Input
          id="organization-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
      </div>
      <Button type="submit" disabled={pending}>
        Create account
      </Button>
    </form>
  );
}
