"use client";

import { FULL_ACCESS, HIDEABLE_AREAS, type MemberAccess } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Switch } from "@jendal-workspace/ui/components/motion/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";

const LABELS = { requests: "Requests", projects: "Projects", storefront: "Shop" };

function AccessRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-[14px]">{label}</p>
        {description ? <p className="text-[13px] leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} ariaLabel={label} />
    </div>
  );
}

// What a member can open, on top of what their role allows. Changes are held until saved, since saving ends the
// member's older threads.
export default function MemberAccessEditor({ teamSlug, userId }: { teamSlug: string; userId: string }) {
  const cache = useQueryClient();
  const current = useQuery(trpc.servicesTeam.memberAccess.queryOptions({ teamSlug }));
  const [draft, setDraft] = useState<MemberAccess | null>(null);
  const save = useMutation(trpc.servicesTeam.setMemberAccess.mutationOptions({
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: trpc.servicesTeam.memberAccess.queryKey({ teamSlug }) });
      setDraft(null);
      toast.success("Access saved");
    },
  }));
  const access = draft ?? current.data?.[userId] ?? FULL_ACCESS;
  const change = (patch: Partial<MemberAccess>) => { save.reset(); setDraft({ ...access, ...patch }); };

  if (current.isError) return <p role="alert" className="text-[13px] text-destructive">Could not load access settings.</p>;

  return (
    <fieldset disabled={current.isPending || save.isPending} className="min-w-0">
      <legend className="sr-only">Access</legend>
      <div className="divide-y">
        {HIDEABLE_AREAS.map((area) => (
          <AccessRow
            key={area}
            label={LABELS[area]}
            checked={!access.hidden.includes(area)}
            onChange={(on) => change({ hidden: on ? access.hidden.filter((item) => item !== area) : [...access.hidden, area] })}
          />
        ))}
        <AccessRow label="Project prices and payments" checked={!access.hideProjectFinances} onChange={(on) => change({ hideProjectFinances: !on })} />
        <AccessRow
          label="Read-only Finances"
          description="Team payments and payouts, never approving, sending or changing money."
          checked={access.moneyViewer}
          onChange={(on) => change({ moneyViewer: on })}
        />
      </div>
      <p className="mt-3 text-[13px] leading-5 text-muted-foreground">
        Their role still decides what they can do; a hidden page is hidden from their assistant too. Saving ends their
        older threads.
      </p>
      {save.error ? <p role="alert" className="mt-3 text-[13px] text-destructive">{save.error.message}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        {draft ? <Button type="button" variant="ghost" size="sm" onClick={() => { setDraft(null); save.reset(); }}>Discard</Button> : null}
        <Button type="button" size="sm" disabled={!draft || save.isPending} onClick={() => save.mutate({ teamSlug, userId, ...access, hidden: [...access.hidden] })}>
          {save.isPending ? "Saving…" : "Save access"}
        </Button>
      </div>
    </fieldset>
  );
}
