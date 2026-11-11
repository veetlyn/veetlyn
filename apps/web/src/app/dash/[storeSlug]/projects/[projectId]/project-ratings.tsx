"use client";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import { Button } from "@jendal-workspace/ui/components/button";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";

import { trpc } from "@/utils/trpc";

type Ratings = inferRouterOutputs<AppRouter>["project"]["get"]["ratings"];

export function ProjectRatings({ teamSlug, projectId, ratings, onChanged }: { teamSlug: string; projectId: string; ratings: Ratings; onChanged: () => void }) {
  const [rating, setRating] = useState(ratings.clientRating?.rating ?? 0);
  const [note, setNote] = useState(ratings.clientRating?.note ?? "");
  const save = useMutation(trpc.project.rateClient.mutationOptions({ onSuccess: onChanged }));
  return (
    <section aria-labelledby="project-ratings-heading" className="space-y-4">
      <h2 id="project-ratings-heading" className="text-lg font-semibold">Ratings</h2>
      {/* What the client said in public, read-only, apart from the team's own private judgement below it. */}
      <div className="space-y-1 rounded-[10px] border p-3">
        <h3 className="text-sm font-medium">Public review</h3>
        {ratings.review ? (
          <>
            <p className="text-sm">{ratings.review.rating} of 5 stars · {ratings.review.reviewerName}</p>
            <p className="whitespace-pre-line text-sm text-muted-foreground">{ratings.review.body}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">The client has not reviewed this project.</p>
        )}
      </div>
      {ratings.canRateClient ? (
        <details className="group rounded-[10px] border p-3" open={save.isPending || save.isError || undefined}>
          <summary className="cursor-pointer text-sm font-medium">
            Private client rating
            <span className="ml-2 font-normal text-muted-foreground">{ratings.clientRating ? `${ratings.clientRating.rating} of 5` : "Not rated"}</span>
          </summary>
          <form className="mt-3 grid gap-3" onSubmit={(event) => { event.preventDefault(); save.mutate({ teamSlug, projectId, rating, note }); }}>
            <p className="text-xs text-muted-foreground">Private: only your team’s admins and managers see this. Never shown to the client or other sellers.</p>
            <label className="grid gap-1 text-sm">Stars<select required value={rating || ""} disabled={save.isPending} onChange={(e) => setRating(Number(e.target.value))} className="rounded-md border bg-card p-2"><option value="" disabled>Choose a rating</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} of 5</option>)}</select></label>
            <label className="grid gap-1 text-sm">Private note (optional)<Textarea value={note} disabled={save.isPending} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
            <Button type="submit" disabled={save.isPending || rating < 1} className="justify-self-start">{save.isPending ? "Saving…" : "Save private rating"}</Button>
            {save.error ? <p role="alert" className="text-sm text-destructive">{save.error.message}</p> : null}
            {save.isSuccess ? <p role="status" className="text-sm">Private rating saved.</p> : null}
          </form>
        </details>
      ) : ratings.clientRating ? (
        <div className="space-y-1 rounded-[10px] border p-3 text-sm">
          <h3 className="font-medium">Private client rating <span className="font-normal text-muted-foreground">· only your team sees this</span></h3>
          <p>{ratings.clientRating.rating} of 5 stars</p>
          <p className="whitespace-pre-line text-muted-foreground">{ratings.clientRating.note}</p>
        </div>
      ) : null}
    </section>
  );
}
