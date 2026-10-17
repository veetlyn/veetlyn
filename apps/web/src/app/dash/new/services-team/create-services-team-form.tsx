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

export default function CreateServicesTeamForm({ dashOrigin }: { dashOrigin: string }) {
  const router = useRouter();
  const [solo, setSolo] = useState(true);
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
    : slugStatus(slug, settled ? check.data : undefined, (s) => `${dashOrigin}/${s}`, "services");
  const canSubmit = name.trim().length >= 2 && status?.tone === "available" && !create.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) create.mutate({ name: name.trim(), slug, solo });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 grid gap-6">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who is selling?</legend>
        <div className="grid gap-2">
          <label className="flex items-start gap-3 border p-3 has-[:checked]:border-foreground has-[:checked]:bg-accent">
            <input
              type="radio"
              name="seller-kind"
              value="solo"
              checked={solo}
              onChange={() => setSolo(true)}
              className="mt-1 accent-current"
            />
            <span>
              <span className="block font-medium">Just me</span>
              <span className="block text-sm text-muted-foreground">
                You do the work and keep the whole price. No members, no payouts.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 border p-3 has-[:checked]:border-foreground has-[:checked]:bg-accent">
            <input
              type="radio"
              name="seller-kind"
              value="team"
              checked={!solo}
              onChange={() => setSolo(false)}
              className="mt-1 accent-current"
            />
            <span>
              <span className="block font-medium">A team</span>
              <span className="block text-sm text-muted-foreground">
                Members share the price: your team cut and a management fee apply.
              </span>
            </span>
          </label>
        </div>
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="team-name">Name</Label>
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
        <Label htmlFor="team-slug">Address</Label>
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>{dashOrigin}/</InputGroupText>
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
        {create.isPending ? "Creating…" : solo ? "Create my seller page" : "Create our team"}
      </Button>
    </form>
  );
}
