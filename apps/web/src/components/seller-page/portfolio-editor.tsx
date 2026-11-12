"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { trpc } from "@/utils/trpc";

export function PortfolioEditor({ teamSlug, items }: { teamSlug: string; items: { id: string; title: string; url: string }[] }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.seller.preview.queryKey({ teamSlug }) });
  const add = useMutation(trpc.project.portfolioAdd.mutationOptions({ onSuccess: () => { setTitle(""); setUrl(""); setDescription(""); void refresh(); } }));
  const remove = useMutation(trpc.project.portfolioRemove.mutationOptions({ onSuccess: refresh }));
  const busy = add.isPending || remove.isPending;
  const error = add.error ?? remove.error;
  return (
    <section aria-labelledby="portfolio-editor-heading" className="mx-auto w-full max-w-5xl border-b px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="portfolio-editor-heading" className="text-sm font-medium">Portfolio</h2>
        <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((value) => !value)}>
          {open ? "Close portfolio editor" : "Manage portfolio"}
        </Button>
      </div>
      {open ? <div id={regionId} className="mt-4 grid max-w-xl gap-4">
        <p className="text-sm text-muted-foreground">Link to work you have permission to share publicly. Do not publish a client’s private files.</p>
        {items.length ? <ul className="divide-y">{items.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 py-2"><a href={item.url} target="_blank" rel="noopener noreferrer" className="min-w-0 break-words text-sm underline">{item.title}</a><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => remove.mutate({ teamSlug, id: item.id })} aria-label={`Remove ${item.title} from portfolio`}>Remove</Button></li>)}</ul> : null}
        <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); add.mutate({ teamSlug, title, url, description }); }}>
          <fieldset disabled={busy} className="grid gap-3">
            <label className="grid gap-1 text-sm">Title<Input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="grid gap-1 text-sm">Link to work<Input required type="url" placeholder="https://…" maxLength={2000} value={url} onChange={(e) => setUrl(e.target.value)} /></label>
            <label className="grid gap-1 text-sm">Description (optional)<Textarea maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            <Button type="submit" className="justify-self-start">{add.isPending ? "Adding…" : "Add to portfolio"}</Button>
          </fieldset>
        </form>
        {error ? <p role="alert" className="text-sm text-destructive">{error.message}</p> : null}
      </div> : null}
    </section>
  );
}
