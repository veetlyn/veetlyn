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
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { trpc } from "@/utils/trpc";

const TONE_CLASS = {
  pending: "text-muted-foreground",
  available: "text-emerald-700 dark:text-emerald-400",
  problem: "text-destructive",
} as const;

export default function CreateServicesTeamForm({ adminOrigin }: { adminOrigin: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [typedSlug, setTypedSlug] = useState<string | null>(null);
  // The address follows the name until the user edits it.
  const slug = (typedSlug ?? suggestStoreSlug(name)).trim().toLowerCase();
  const debouncedSlug = useDebouncedValue(slug, 300);

  // Stores and services teams share the slug namespace, so the store check answers for both.
  const check = useQuery({
    ...trpc.store.checkSlug.queryOptions({ slug: debouncedSlug }),
    enabled: debouncedSlug.length > 0,
  });
  const create = useMutation(
    trpc.servicesTeam.create.mutationOptions({ onSuccess: (team) => router.push(`/${team.slug}`) }),
  );

  const settled = debouncedSlug === slug && !check.isFetching;
  const status = create.error
    ? { tone: "problem" as const, text: create.error.message }
    : slugStatus(slug, settled ? check.data : undefined, (s) => `${adminOrigin}/${s}`, "services");
  const canSubmit = name.trim().length >= 2 && status?.tone === "available" && !create.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) create.mutate({ name: name.trim(), slug });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 grid gap-6">
      <div className="space-y-2">
        <Label htmlFor="team-name">Team name</Label>
        <Input
          id="team-name"
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
        <Label htmlFor="team-slug">Team address</Label>
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>{adminOrigin}/</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id="team-slug"
            value={typedSlug ?? suggestStoreSlug(name)}
            onChange={(e) => {
              setTypedSlug(e.target.value);
              create.reset();
            }}
            placeholder="acme-studio"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="team-slug-status"
            required
          />
        </InputGroup>
        <p id="team-slug-status" aria-live="polite" className={`min-h-5 text-sm ${status ? TONE_CLASS[status.tone] : ""}`}>
          {status?.text}
        </p>
      </div>
      <Button type="submit" disabled={!canSubmit} className="justify-self-start">
        {create.isPending ? "Creating your team…" : "Create services team"}
      </Button>
    </form>
  );
}
