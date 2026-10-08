"use client";

import {
  canAssignFreelancer,
  canProposeAmendment,
  canSubmitDelivery,
  formatMoney,
  money,
  parseMajorAmount,
  projectStatusLabel,
  quoteAuthor,
  quoteAuthorRefusalMessage,
  quoteTotalMinor,
  type MoneyCurrency,
  type QuoteItemDraft,
} from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import { DeliveryLink } from "@/components/delivery-link";
import Loader from "@/components/loader";
import { deliveryDraftProblem, deliveryStaffStatusLabel, newestFirst } from "@/lib/delivery";
import { trpc } from "@/utils/trpc";

type Detail = inferRouterOutputs<AppRouter>["project"]["get"];

type ItemRow = { description: string; amount: string; extraDays: string };

const EMPTY_ROW: ItemRow = { description: "", amount: "", extraDays: "0" };

function parseRows(rows: ItemRow[]): QuoteItemDraft[] | null {
  const items: QuoteItemDraft[] = [];
  for (const row of rows) {
    const amountMinor = parseMajorAmount(row.amount);
    const extraDays = Number(row.extraDays || "0");
    if (row.description.trim() === "" || amountMinor === null || !Number.isInteger(extraDays)) return null;
    items.push({ description: row.description.trim(), amountMinor, extraDays });
  }
  return items;
}

function ItemRowsEditor({ rows, onChange }: { rows: ItemRow[]; onChange: (rows: ItemRow[]) => void }) {
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            aria-label={`Line ${index + 1} description`}
            placeholder="What this line covers"
            value={row.description}
            onChange={(e) => onChange(rows.map((r, i) => (i === index ? { ...r, description: e.target.value } : r)))}
          />
          <Input
            aria-label={`Line ${index + 1} amount`}
            placeholder="0.00"
            inputMode="decimal"
            className="w-28"
            value={row.amount}
            onChange={(e) => onChange(rows.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r)))}
          />
          <Input
            aria-label={`Line ${index + 1} extra days`}
            placeholder="Days"
            inputMode="numeric"
            className="w-20"
            value={row.extraDays}
            onChange={(e) => onChange(rows.map((r, i) => (i === index ? { ...r, extraDays: e.target.value } : r)))}
          />
          <Button type="button" variant="ghost" disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, i) => i !== index))}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={() => onChange([...rows, { ...EMPTY_ROW }])}>
        Add a line
      </Button>
    </div>
  );
}

function QuoteCard({ quote, currency }: { quote: Detail["quotes"][number]; currency: MoneyCurrency }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">
          Quote v{quote.version} · {formatMoney(money(currency, quote.amountMinor))}
        </p>
        <span className="text-sm text-muted-foreground">{quote.status}</span>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {quote.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-4">
            <span>
              {item.description}
              {item.extraDays > 0 ? ` (+${item.extraDays} days)` : ""}
            </span>
            <span>{formatMoney(money(currency, item.amountMinor))}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-muted-foreground">Delivery in {quote.deliveryDays} days after the deposit.</p>
    </div>
  );
}

export default function ProjectDetail({
  teamSlug,
  projectId,
  siteOrigin,
}: {
  teamSlug: string;
  projectId: string;
  siteOrigin: string;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({ ...trpc.project.get.queryOptions({ teamSlug, projectId }), retry: false });
  const members = useQuery({ ...trpc.project.members.queryOptions({ teamSlug }), retry: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.project.get.queryOptions({ teamSlug, projectId }).queryKey });

  const [freelancerId, setFreelancerId] = useState("");
  const [quoteRows, setQuoteRows] = useState<ItemRow[]>([{ ...EMPTY_ROW }]);
  const [deliveryDays, setDeliveryDays] = useState("14");
  const [quoteFreelancerId, setQuoteFreelancerId] = useState("");
  const [note, setNote] = useState("");
  const [addRows, setAddRows] = useState<ItemRow[]>([]);
  const [removeItemIds, setRemoveItemIds] = useState<string[]>([]);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [deliveryLink, setDeliveryLink] = useState("");

  const assign = useMutation(trpc.project.assign.mutationOptions({ onSuccess: refresh }));
  const addQuote = useMutation(trpc.project.addQuote.mutationOptions({ onSuccess: refresh }));
  const proposeAmendment = useMutation(trpc.project.proposeAmendment.mutationOptions({ onSuccess: refresh }));
  const deliver = useMutation(
    trpc.project.deliver.mutationOptions({
      onSuccess: () => {
        setDeliveryNote("");
        setDeliveryLink("");
        return refresh();
      },
    }),
  );

  if (detail.isPending) return <Loader />;
  if (detail.isError) {
    return (
      <main className="container mx-auto max-w-3xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-semibold">Project not found</h1>
        <Link href={`/${teamSlug}/projects`} className="underline">
          Back to projects
        </Link>
      </main>
    );
  }

  const { project, quotes, amendments, payments, deliveries, clientPath, role, quotingMode, viewerId } = detail.data;
  const currency = project.currency as MoneyCurrency;
  const currentQuote = quotes.find((q) => q.status === "accepted");
  const proposedQuotes = quotes.filter((q) => q.status === "proposed");
  const pendingAmendment = amendments.find((a) => a.status === "pending");
  const days = Number(deliveryDays);
  const quoteItems = parseRows(quoteRows);
  const author = quoteAuthor({
    role,
    actorId: viewerId,
    quotingMode,
    assignedFreelancerId: project.assignedFreelancerId,
    freelancerId: quoteFreelancerId || null,
  });
  const canQuote = project.status === "quoting" && author.ok;
  // Staff name the freelancer in team mode and in open mode; only assigned mode implies them.
  const needsFreelancerName = role !== "freelancer" && quotingMode !== "assigned";
  const canDeliver =
    project.status === "in_progress" &&
    canSubmitDelivery({ role, actorId: viewerId, assignedFreelancerId: project.assignedFreelancerId });
  const deliveryProblem = deliveryDraftProblem({ note: deliveryNote, link: deliveryLink });
  // An untouched form only disables the button; the hint appears once something is typed.
  const deliveryDraftTouched = deliveryNote !== "" || deliveryLink !== "";
  const deliveryHint = deliveryDraftTouched ? deliveryProblem : null;

  function handleAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (freelancerId) assign.mutate({ teamSlug, projectId, freelancerId });
  }

  function handleQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quoteItems || !Number.isInteger(days) || days < 1 || !canQuote) return;
    addQuote.mutate({
      teamSlug,
      projectId,
      items: quoteItems,
      deliveryDays: days,
      ...(quoteFreelancerId ? { freelancerId: quoteFreelancerId } : {}),
    });
  }

  function handleAmend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const add = parseRows(addRows) ?? undefined;
    if (addRows.length > 0 && !add) return;
    if ((add?.length ?? 0) === 0 && removeItemIds.length === 0) return;
    proposeAmendment.mutate({ teamSlug, projectId, add: add ?? [], removeItemIds, note });
  }

  function handleDeliver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deliveryProblem || deliver.isPending) return;
    deliver.mutate({ teamSlug, projectId, note: deliveryNote, link: deliveryLink });
  }

  return (
    <main className="container mx-auto max-w-3xl space-y-8 px-4 py-6">
      <div className="space-y-1">
        <Link href={`/${teamSlug}/projects`} className="text-sm text-muted-foreground">
          Projects
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
        <p className="text-sm text-muted-foreground">
          {projectStatusLabel(project.status)} · {project.clientEmail ?? project.clientDiscordId ?? "No client contact"}
          {project.finalPriceMinor !== null ? ` · Final price ${formatMoney(money(currency, project.finalPriceMinor))}` : ""}
        </p>
        {project.brief ? <p className="text-sm">{project.brief}</p> : null}
        <p className="text-sm">
          Client link:{" "}
          <a href={`${siteOrigin}${clientPath}`} className="underline underline-offset-4 break-all">
            {siteOrigin}
            {clientPath}
          </a>
        </p>
      </div>

      {canAssignFreelancer(role) && project.status === "quoting" ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Assignment</h2>
          <form onSubmit={handleAssign} className="flex items-end gap-2">
            <div className="space-y-2">
              <Label htmlFor="assign-freelancer">Freelancer</Label>
              <select
                id="assign-freelancer"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={freelancerId}
                onChange={(e) => setFreelancerId(e.target.value)}
              >
                <option value="">Choose a member…</option>
                {(members.data ?? []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} ({member.role})
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={!freelancerId || assign.isPending}>
              Assign
            </Button>
          </form>
          {assign.error ? <p className="text-sm text-destructive">{assign.error.message}</p> : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Quotes</h2>
        {quotes.length === 0 ? <p className="text-sm text-muted-foreground">No quotes yet.</p> : null}
        {quotes.map((quote) => (
          <QuoteCard key={quote.id} quote={quote} currency={currency} />
        ))}
        {project.status === "quoting" && (role !== "freelancer" || quotingMode !== "team") ? (
          <form onSubmit={handleQuote} className="space-y-3 rounded-lg border p-4">
            <h3 className="font-medium">New quote</h3>
            <ItemRowsEditor rows={quoteRows} onChange={setQuoteRows} />
            <div className="flex items-end gap-2">
              <div className="space-y-2">
                <Label htmlFor="delivery-days">Delivery days</Label>
                <Input id="delivery-days" inputMode="numeric" className="w-24" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} />
              </div>
              {needsFreelancerName ? (
                <div className="space-y-2">
                  <Label htmlFor="quote-freelancer">Freelancer</Label>
                  <select
                    id="quote-freelancer"
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={quoteFreelancerId}
                    onChange={(e) => setQuoteFreelancerId(e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {(members.data ?? []).map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <Button type="submit" disabled={!quoteItems || !Number.isInteger(days) || days < 1 || !canQuote || addQuote.isPending}>
                Send quote
              </Button>
            </div>
            {quoteItems ? (
              <p className="text-sm text-muted-foreground">Total {formatMoney(money(currency, quoteTotalMinor(quoteItems)))}</p>
            ) : (
              <p className="text-sm text-destructive">Each line needs a description and an amount above zero.</p>
            )}
            {/* Without this, Send quote stays disabled with no reason given (for example, nobody assigned yet). */}
            {!author.ok ? <p className="text-sm text-muted-foreground">{quoteAuthorRefusalMessage(author.reason)}</p> : null}
            {addQuote.error ? <p className="text-sm text-destructive">{addQuote.error.message}</p> : null}
          </form>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Amendments</h2>
        {amendments.length === 0 ? <p className="text-sm text-muted-foreground">No amendments.</p> : null}
        {amendments.map((amendment) => (
          <div key={amendment.id} className="rounded-lg border p-4 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {amendment.deltaMinor > 0 ? "+" : ""}
                {formatMoney(money(currency, amendment.deltaMinor))} → {formatMoney(money(currency, amendment.newAmountMinor))}
              </p>
              <span className="text-muted-foreground">{amendment.status}</span>
            </div>
            {amendment.note ? <p className="mt-1">{amendment.note}</p> : null}
          </div>
        ))}
        {(project.status === "in_progress" || project.status === "delivered") &&
        !pendingAmendment &&
        canProposeAmendment({ role, actorId: viewerId, assignedFreelancerId: project.assignedFreelancerId }) &&
        currentQuote ? (
          <form onSubmit={handleAmend} className="space-y-3 rounded-lg border p-4">
            <h3 className="font-medium">Propose an amendment</h3>
            <p className="text-sm text-muted-foreground">Remove lines from the current quote, or add new ones.</p>
            {currentQuote.items.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={removeItemIds.includes(item.id)}
                  onCheckedChange={(checked) =>
                    setRemoveItemIds((ids) => (checked === true ? [...ids, item.id] : ids.filter((id) => id !== item.id)))
                  }
                />
                Remove “{item.description}” ({formatMoney(money(currency, item.amountMinor))})
              </label>
            ))}
            {addRows.length > 0 ? <ItemRowsEditor rows={addRows} onChange={setAddRows} /> : null}
            {addRows.length === 0 ? (
              <Button type="button" variant="outline" onClick={() => setAddRows([{ ...EMPTY_ROW }])}>
                Add a line
              </Button>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="amendment-note">Note for the client</Label>
              <Textarea id="amendment-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button type="submit" disabled={proposeAmendment.isPending || (addRows.length === 0 && removeItemIds.length === 0)}>
              Propose amendment
            </Button>
            {proposeAmendment.error ? <p className="text-sm text-destructive">{proposeAmendment.error.message}</p> : null}
          </form>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Deliveries</h2>
        {deliveries.length === 0 ? <p className="text-sm text-muted-foreground">No deliveries yet.</p> : null}
        {newestFirst(deliveries).map((delivery) => (
          <div key={delivery.id} className="space-y-2 rounded-lg border p-4 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium">Delivered {new Date(delivery.createdAt).toLocaleString()}</p>
              <span className="text-muted-foreground">{deliveryStaffStatusLabel(delivery.status)}</span>
            </div>
            {delivery.note ? <p className="whitespace-pre-wrap">{delivery.note}</p> : null}
            <DeliveryLink link={delivery.link} />
            {delivery.status === "changes_requested" && delivery.clientNote ? (
              <div className="rounded-md bg-muted p-3">
                <p className="font-medium">The client asked for changes</p>
                <p className="whitespace-pre-wrap">{delivery.clientNote}</p>
              </div>
            ) : null}
          </div>
        ))}
        {project.status === "delivered" ? (
          <p className="text-sm text-muted-foreground">Waiting for the client to accept the delivery or ask for changes.</p>
        ) : null}
        {canDeliver ? (
          <form onSubmit={handleDeliver} className="space-y-3 rounded-lg border p-4">
            <h3 className="font-medium">Deliver</h3>
            <div className="space-y-2">
              <Label htmlFor="delivery-note">Note for the client</Label>
              <Textarea
                id="delivery-note"
                rows={4}
                aria-describedby={deliveryHint ? "delivery-problem" : undefined}
                value={deliveryNote}
                onChange={(e) => setDeliveryNote(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delivery-link">Link</Label>
              <Input
                id="delivery-link"
                aria-describedby={deliveryHint ? "delivery-problem" : undefined}
                inputMode="url"
                placeholder="https://"
                value={deliveryLink}
                onChange={(e) => setDeliveryLink(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={deliveryProblem !== null || deliver.isPending}>
              Submit delivery
            </Button>
            {/* Always mounted so screen readers pick up the message when it appears. */}
            <p id="delivery-problem" aria-live="polite" className="text-sm text-destructive empty:hidden">
              {deliveryHint}
            </p>
            {deliver.error ? (
              <p role="alert" className="text-sm text-destructive">
                {deliver.error.message}
              </p>
            ) : null}
          </form>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Payments</h2>
        {payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet. The deposit is created when the client accepts a quote.</p> : null}
        {payments.map((payment) => (
          <div key={payment.id} className="rounded-lg border p-4 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium capitalize">{payment.kind.replace("_", "-")}</p>
              <span className="text-muted-foreground">{payment.status}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {payment.lines.map((line, index) => (
                <li key={index} className="flex justify-between gap-4">
                  <span>{line.label}</span>
                  <span>{formatMoney(money(currency, line.amountMinor))}</span>
                </li>
              ))}
            </ul>
            {payment.status === "pending" ? (
              <p className="mt-2 text-muted-foreground">Waiting for the client to pay.</p>
            ) : null}
          </div>
        ))}
      </section>
    </main>
  );
}
