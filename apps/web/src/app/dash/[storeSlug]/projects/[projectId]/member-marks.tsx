"use client";

import { canServicesTeam } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import { trpc } from "@/utils/trpc";

type Detail = inferRouterOutputs<AppRouter>["project"]["get"];

const MARK_KIND_LABELS = {
  late_update: "Late update",
  late_delivery: "Late delivery",
  quality_refund: "Quality refund",
  warning: "Warning",
} as const satisfies Record<Detail["marks"][number]["kind"], string>;

// Staff see the project's marks; admins also record a warning on the project's member.
export function MemberMarks({
  teamSlug,
  project,
  marks,
  role,
  onChanged,
}: {
  teamSlug: string;
  project: Detail["project"];
  marks: Detail["marks"];
  role: Detail["role"];
  onChanged: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const record = useMutation(
    trpc.project.recordWarning.mutationOptions({
      onSuccess: async () => {
        setNote("");
        await onChanged();
      },
    }),
  );
  const canWarn = canServicesTeam(role, "resolve_cases") && project.assignedFreelancerId !== null;
  if (marks.length === 0 && !canWarn) return null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (note.trim() === "") return;
    record.mutate({ teamSlug, projectId: project.id, note });
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Member marks</h2>
      {marks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No marks on this project.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {marks.map((mark) => (
            <li key={mark.id}>
              <span className="font-medium">{mark.memberName}</span>
              <span className="text-muted-foreground">
                {" "}· {MARK_KIND_LABELS[mark.kind]}{mark.note ? ` · ${mark.note}` : ""} · {new Date(mark.createdAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canWarn ? (
        <form onSubmit={handleSubmit} className="space-y-2">
          <Label htmlFor="warning-note">Record a warning</Label>
          <Input
            id="warning-note"
            value={note}
            maxLength={500}
            placeholder="What happened"
            onChange={(e) => {
              record.reset();
              setNote(e.target.value);
            }}
          />
          <Button type="submit" variant="outline" disabled={record.isPending || note.trim() === ""}>
            {record.isPending ? "Saving…" : "Record warning"}
          </Button>
          {record.error ? (
            <p role="alert" className="text-sm text-destructive">
              {record.error.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
