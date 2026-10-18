"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useState } from "react";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import { formatMinor } from "@/lib/money";
import { trpc } from "@/utils/trpc";

type TeamPayoutRequest = inferRouterOutputs<AppRouter>["payouts"]["list"]["payouts"][number];
type ImportCounts = inferRouterOutputs<AppRouter>["payouts"]["importPayoutsWeb"];

// Unconfirmed sends and cancelled exports PayPal shows as pending may already be with PayPal, and a payout before its
// payday must wait, so the server refuses them.
function exportable(request: TeamPayoutRequest, now: Date): boolean {
  if (request.status !== "queued" || request.uncertain || request.reviewReason !== null) return false;
  return request.sendAfter === null || Date.parse(request.sendAfter) <= now.getTime();
}

function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importSummary(counts: ImportCounts): string {
  let summary = `${counts.settled} settled, ${counts.failed} failed, ${counts.pending} still pending, ${counts.unmatched} not matched.`;
  if (counts.mismatched > 0) {
    summary += ` ${counts.mismatched} did not match the exported amount; check them in PayPal.`;
  }
  if (counts.paidTwice > 0) summary += ` ${counts.paidTwice} were paid twice; recover the extra payment in PayPal.`;
  return summary;
}

export function PayoutsWebSection({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const requests = useQuery({ ...trpc.payouts.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const credentials = useQuery({
    ...trpc.payouts.credentials.queryOptions({ teamSlug }),
    retry: false,
    meta: { silent: true },
  });
  // Payouts left out of the export; every other exportable payout is selected, including ones that appear later.
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [fileInputKey, setFileInputKey] = useState(0);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.payouts.list.queryKey({ teamSlug }) });
  const exportCsv = useMutation(
    trpc.payouts.exportPayoutsWeb.mutationOptions({
      onSuccess: (result) => downloadCsv(result.csv, result.filename),
      onSettled: invalidate,
    }),
  );
  const importLog = useMutation(trpc.payouts.importPayoutsWeb.mutationOptions({ onSettled: invalidate }));

  // Only a successful credentials read of "none saved" means automatic payouts are off.
  if (!requests.data || credentials.data !== null) return null;

  const now = new Date();
  // Stays visible with nothing to export: settling the last exported payout must not hide the import result.
  const approved = requests.data.payouts.filter((request) => exportable(request, now));

  const selectedIds = approved.filter((request) => !unchecked.has(request.id)).map((request) => request.id);

  function toggle(id: string, checked: boolean) {
    setUnchecked((current) => {
      const next = new Set(current);
      if (checked) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    exportCsv.reset();
    importLog.reset();
    const csv = await file.text();
    // A fresh input lets the same file be chosen again after a failed import.
    setFileInputKey((key) => key + 1);
    importLog.mutate({ teamSlug, csv });
  }

  return (
    <section aria-labelledby="payouts-web-heading" className="space-y-4 panel p-4">
      <h2 id="payouts-web-heading" className="font-medium">
        PayPal Payouts Web
      </h2>
      {approved.length > 0 ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            importLog.reset();
            exportCsv.mutate({ teamSlug, requestIds: selectedIds });
          }}
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Approved payouts</legend>
            <ul className="space-y-2">
              {approved.map((request) => (
                <li key={request.id}>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={!unchecked.has(request.id)}
                      onCheckedChange={(checked) => toggle(request.id, checked === true)}
                    />
                    <span>
                      <span className="font-medium">{request.memberName}</span> ·{" "}
                      {formatMinor(request.amountMinor, request.currency)}
                      {request.sentMinor !== null && request.feeEstimateMinor !== null ? (
                        <span className="block text-muted-foreground">
                          Sends {formatMinor(request.sentMinor, request.currency)} after PayPal's fee (about)
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <Button type="submit" disabled={selectedIds.length === 0 || exportCsv.isPending}>
            {exportCsv.isPending ? "Exporting…" : "Export for PayPal Payouts Web"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">No approved payouts to export.</p>
      )}
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>In PayPal, open Pay &amp; Get Paid &gt; Payouts.</li>
        <li>Upload this file and send the payout.</li>
        <li>When it shows Processed, open it under Activity and choose Download &gt; Download (CSV).</li>
      </ol>
      <div className="space-y-2">
        <Label htmlFor="payouts-web-log">Import PayPal's CSV log</Label>
        <Input
          key={fileInputKey}
          id="payouts-web-log"
          type="file"
          accept=".csv,text/csv"
          disabled={importLog.isPending}
          onChange={handleFile}
        />
      </div>
      <p aria-live="polite" className="text-sm">
        {importLog.data ? importSummary(importLog.data) : null}
      </p>
      {exportCsv.error ? (
        <p role="alert" className="text-sm text-destructive">
          {exportCsv.error.message}
        </p>
      ) : null}
      {importLog.error ? (
        <p role="alert" className="text-sm text-destructive">
          {importLog.error.message}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Your PayPal account needs Payouts turned on. PayPal charges its fee to your account; Payleor takes it from the
        member's payout, as with automatic payouts.
      </p>
    </section>
  );
}
