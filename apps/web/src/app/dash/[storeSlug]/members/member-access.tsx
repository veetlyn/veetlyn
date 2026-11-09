"use client";

import { FULL_ACCESS, HIDEABLE_AREAS, type MemberAccess } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { trpc } from "@/utils/trpc";

const LABELS = { requests: "Requests", projects: "Projects", storefront: "Shop" };

export default function MemberAccessEditor({ teamSlug, userId, name }: { teamSlug: string; userId: string; name: string }) {
  const cache = useQueryClient();
  const current = useQuery(trpc.servicesTeam.memberAccess.queryOptions({ teamSlug }));
  const [draft, setDraft] = useState<MemberAccess | null>(null);
  const save = useMutation(trpc.servicesTeam.setMemberAccess.mutationOptions({
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: trpc.servicesTeam.memberAccess.queryKey({ teamSlug }) });
      setDraft(null);
    },
  }));
  const access = draft ?? current.data?.[userId] ?? FULL_ACCESS;
  const change = (patch: Partial<MemberAccess>) => { save.reset(); setDraft({ ...access, ...patch }); };

  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer py-1 underline underline-offset-4">Access for {name}</summary>
      {current.isError ? <p role="alert">Could not load access settings.</p> : (
        <fieldset disabled={current.isPending || save.isPending} className="grid gap-2 py-3">
          <legend className="sr-only">Access for {name}</legend>
          <p className="max-w-sm text-muted-foreground">Their role still decides what they can do. Hiding a page also hides it from their assistant.</p>
          {HIDEABLE_AREAS.map((area) => (
            <label key={area} className="flex min-h-8 items-center gap-2">
              <input type="checkbox" checked={!access.hidden.includes(area)} onChange={(event) => change({
                hidden: event.target.checked ? access.hidden.filter((item) => item !== area) : [...access.hidden, area],
              })} />
              {LABELS[area]}
            </label>
          ))}
          <label className="flex min-h-8 items-center gap-2">
            <input type="checkbox" checked={!access.hideProjectFinances} onChange={(event) => change({ hideProjectFinances: !event.target.checked })} />
            Project prices and payments
          </label>
          <label className="flex min-h-8 items-center gap-2">
            <input type="checkbox" checked={access.moneyViewer} onChange={(event) => change({ moneyViewer: event.target.checked })} />
            Read-only Finances
          </label>
          <p className="max-w-sm text-muted-foreground">Read-only Finances shows team payments and payouts. It never allows approving, sending or changing money.</p>
          <p className="max-w-sm text-muted-foreground">Changing access makes older threads unavailable to this member. They can start a new thread with their current access.</p>
          <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={!draft || save.isPending} onClick={() => save.mutate({ teamSlug, userId, ...access, hidden: [...access.hidden] })}>
            {save.isPending ? "Saving…" : "Save access"}
          </Button>
          {save.error ? <p role="alert" className="text-destructive">{save.error.message}</p> : null}
          <p role="status">{save.isSuccess ? "Access saved." : ""}</p>
        </fieldset>
      )}
    </details>
  );
}
