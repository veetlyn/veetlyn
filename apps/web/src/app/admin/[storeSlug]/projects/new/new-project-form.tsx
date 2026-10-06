"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { trpc } from "@/utils/trpc";

export default function NewProjectForm({ teamSlug }: { teamSlug: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientDiscordId, setClientDiscordId] = useState("");
  const [brief, setBrief] = useState("");

  const create = useMutation(
    trpc.project.create.mutationOptions({
      // The detail page the redirect lands on shows the client link with a copy button.
      onSuccess: ({ projectId }) => router.push(`/${teamSlug}/projects/${projectId}`),
    }),
  );

  const hasClient = clientEmail.trim() !== "" || clientDiscordId.trim() !== "";
  const canSubmit = title.trim().length >= 3 && hasClient && !create.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    create.mutate({ teamSlug, title, brief, clientEmail, clientDiscordId, channelId: "" });
  }

  return (
    <main className="container mx-auto max-w-xl px-4 py-6">
      <div className="space-y-1">
        <Link href={`/${teamSlug}/projects`} className="text-sm text-muted-foreground">
          Projects
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
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
