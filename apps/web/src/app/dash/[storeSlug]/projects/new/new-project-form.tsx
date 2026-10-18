"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { trpc } from "@/utils/trpc";

const SELECT_CLASS = "h-9 w-full rounded-md border bg-transparent px-3 text-sm";

export default function NewProjectForm({ teamSlug }: { teamSlug: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientDiscordId, setClientDiscordId] = useState("");
  const [clientName, setClientName] = useState("");
  const [brief, setBrief] = useState("");
  const [offeringId, setOfferingId] = useState("");

  const catalog = useQuery({ ...trpc.servicesCatalog.list.queryOptions({ teamSlug }), retry: false });

  const create = useMutation(
    trpc.project.create.mutationOptions({
      // The detail page the redirect lands on emails the client their link.
      onSuccess: ({ projectId }) => router.push(`/${teamSlug}/projects/${projectId}`),
    }),
  );

  const hasClient = clientEmail.trim() !== "" || clientDiscordId.trim() !== "";
  const canSubmit = title.trim().length >= 3 && hasClient && !create.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    create.mutate({
      teamSlug,
      title,
      brief,
      clientEmail,
      clientDiscordId,
      clientName,
      channelId: "",
      offeringId: offeringId || undefined,
    });
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-7 md:py-8">
      <div className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-3xl">New project</h1>
        <p className="text-sm text-muted-foreground">
          The client gets a private link to follow the project, accept quotes and pay. No account needed.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="mt-8 grid gap-6">
        <div className="space-y-2">
          <Label htmlFor="project-title">Title</Label>
          <Input id="project-title" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={120} autoFocus />
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-offering">Service</Label>
          <select
            id="project-offering"
            value={offeringId}
            onChange={(e) => setOfferingId(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">Not one of my services</option>
            {(catalog.data?.offerings ?? [])
              .filter((offering) => offering.active)
              .map((offering) => (
                <option key={offering.id} value={offering.id}>
                  {offering.name}
                </option>
              ))}
          </select>
          <p className="text-xs text-muted-foreground">Optional. It tells you later what the client asked for.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="client-name">Client name</Label>
          <Input id="client-name" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Optional" maxLength={200} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="client-email">Client email</Label>
          <Input id="client-email" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="client@example.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="client-discord">Client Discord user ID</Label>
          <Input id="client-discord" value={clientDiscordId} onChange={(e) => setClientDiscordId(e.target.value)} placeholder="Optional" />
          <p className="text-xs text-muted-foreground">Add the email, the Discord user, or both.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-brief">Brief</Label>
          <Textarea id="project-brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} placeholder="What the client asked for" />
        </div>
        {create.error ? <p className="text-sm text-destructive">{create.error.message}</p> : null}
        <Button type="submit" disabled={!canSubmit}>
          {create.isPending ? "Starting…" : "Start project"}
        </Button>
      </form>
    </main>
  );
}
