"use client";

import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import {
  ALLOWED_FILE_EXTENSIONS,
  canAssignFreelancer,
  canProposeAmendment,
  canSubmitDelivery,
  formatBytes,
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
import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import { DeliveryFile } from "@/components/delivery-file";
import { DeliveryLink } from "@/components/delivery-link";
import { ValueInput } from "@/components/value-input";
import { competingProposalCount, quoteAttribution } from "@/lib/quote-attribution";
import Loader from "@/components/loader";
import { paymentRefundLabel } from "@/lib/client-refund";
import { AMENDMENT_STATUS_LABELS, PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS, QUOTE_STATUS_LABELS, TEAM_PROJECT_TONES } from "@/lib/status-labels";
import { deliveryDraftProblem, deliveryStaffStatusLabel, newestFirst } from "@/lib/delivery";
import { minorToPriceInput } from "@/lib/money";
import { isNotFoundError, isProjectReadDenied, PROJECT_REFRESH_MS, teamWaitsOnClient } from "@/lib/project-refresh";
import { uploadToPresignedUrl } from "@/lib/upload";
import { trpc, trpcClient } from "@/utils/trpc";
import type { ProjectTab } from "@/lib/project-tabs";

import { ProjectProgress } from "@/components/project-progress";
import { ContextRail, WorkPage } from "@/components/page-composition";

import { ClientsSection } from "./clients-section";
import { ConversationSection } from "./conversation-section";
import PreparedBanner from "@/components/prepared-banner";
import { scheduleLabel, scheduleWhen } from "@/lib/project-schedule";

import { DisputeCard } from "./dispute-card";
import { QuoteCalculator } from "./quote-calculator";
import { MemberMarks } from "./member-marks";
import { ProjectRatings } from "./project-ratings";
import { LateRefundNotice, QualityRefundForm } from "./price-adjustments";
import { RefundSection } from "./refund-section";

type Detail = inferRouterOutputs<AppRouter>["project"]["get"];
type QuoteInput = inferRouterInputs<AppRouter>["project"]["addQuote"];

type ItemRow = { description: string; amount: string; extraDays: string };

const EMPTY_ROW: ItemRow = { description: "", amount: "", extraDays: "0" };

const FILE_ACCEPT = ALLOWED_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(",");

// The deliver form is disabled while it submits, which drops keyboard focus; the error takes it back.
// Defined outside the component so React calls it only when the element mounts, not on every render.
function focusOnMount(node: HTMLElement | null) {
  node?.focus();
}

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

function ItemRowsEditor({ rows, onChange, currency }: { rows: ItemRow[]; onChange: (rows: ItemRow[]) => void; currency: MoneyCurrency }) {
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="grid min-w-0 grid-cols-2 items-end gap-2 md:grid-cols-[minmax(0,1fr)_11rem_8rem_auto]">
          <div className="col-span-2 grid min-w-0 gap-1 md:col-span-1"><span aria-hidden="true" className="text-xs text-muted-foreground">Description</span>
          <Input
            aria-label={`Line ${index + 1} description`}
            placeholder="What this line covers"
            value={row.description}
            onChange={(e) => onChange(rows.map((r, i) => (i === index ? { ...r, description: e.target.value } : r)))}
          />
          </div>
          <div className="grid min-w-0 gap-1"><span aria-hidden="true" className="text-xs text-muted-foreground">Amount</span>
          <ValueInput
            aria-label={`Line ${index + 1} amount`}
            unit={currency}
            placeholder="0.00"
            inputMode="decimal"
            value={row.amount}
            onChange={(e) => onChange(rows.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r)))}
          />
          </div>
          <div className="grid min-w-0 gap-1"><span aria-hidden="true" className="text-xs text-muted-foreground">Extra days</span>
          <ValueInput
            aria-label={`Line ${index + 1} extra days`}
            unit="days"
            type="number"
            min={0}
            step={1}
            placeholder="Days"
            inputMode="numeric"
            value={row.extraDays}
            onChange={(e) => onChange(rows.map((r, i) => (i === index ? { ...r, extraDays: e.target.value } : r)))}
          />
          </div>
          <Button className="col-span-2 justify-self-end md:col-span-1" type="button" variant="ghost" disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, i) => i !== index))}>
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

function QuoteCard({ quote, currency, members }: { quote: Detail["quotes"][number]; currency: MoneyCurrency; members: readonly { id: string; name: string }[] }) {
  const { quotedFor, preparedBy } = quoteAttribution(quote, members);
  return (
    <article data-financial-document className="rounded-lg border px-5 py-6 sm:px-7 sm:py-8">
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-heading text-lg">Quote v{quote.version}</h3>
        <Badge tone={quote.status === "accepted" ? "good" : "neutral"}>{QUOTE_STATUS_LABELS[quote.status]}</Badge>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Quoted by</dt>
        <dd className="font-medium">{quotedFor}</dd>
        {preparedBy ? <><dt className="text-muted-foreground">Prepared by</dt><dd>{preparedBy}, for {quotedFor}</dd></> : null}
        <dt className="text-muted-foreground">Delivery</dt>
        <dd>{quote.deliveryDays === 1 ? "1 day" : `${quote.deliveryDays} days`} after the deposit</dd>
      </dl>
      <ul className="mt-6 divide-y border-y text-sm">
        {quote.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-4 py-4">
            <span>
              {item.description}
              {item.extraDays > 0 ? ` (+${item.extraDays} days)` : ""}
            </span>
            <span className="shrink-0 whitespace-nowrap font-tabular">{formatMoney(money(currency, item.amountMinor))}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-5 flex items-baseline justify-between gap-4"><dt className="font-medium">Work subtotal</dt><dd className="font-tabular text-xl font-semibold">{formatMoney(money(currency, quote.amountMinor))}</dd></dl>
    </article>
  );
}




export default function ProjectDetail({
  teamSlug,
  projectId,
  paypalEnvironment,
  view = "overview",
}: {
  teamSlug: string;
  projectId: string;
  paypalEnvironment: string | undefined;
  view?: ProjectTab;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const seller = useQuery({ ...trpc.agent.seller.queryOptions({ slug: teamSlug }), retry: false, meta: { silent: true } });
  const detail = useQuery({
    ...trpc.project.get.queryOptions({ teamSlug, projectId }),
    retry: false,
    refetchInterval: (query) =>
      query.state.data && !isProjectReadDenied(query.state.error) && teamWaitsOnClient(query.state.data) ? PROJECT_REFRESH_MS : false,
    meta: { quietRefetchErrors: true },
  });
  const financesHiddenForRedirect = detail.data?.financesHidden === true;
  useEffect(() => {
    if (view !== "overview" || !detail.data) return;
    const sync = () => {
      const part = window.location.hash.slice(1);
      const tab = (part === "quotes" || part === "amendments") && !financesHiddenForRedirect ? "quote"
        : part === "deliveries" ? "delivery"
          : part === "conversation" ? "conversation"
            : (part === "payments" || part === "refund") && !financesHiddenForRedirect ? "money"
              : part === "clients" || part === "assignment" || part === "marks" ? "activity" : null;
      if (tab) router.replace(`/${teamSlug}/projects/${projectId}/${tab}#${part}`);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [view, detail.data, financesHiddenForRedirect, teamSlug, projectId, router]);
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
  const [deliveryFile, setDeliveryFile] = useState<File | null>(null);
  // Remounting the file input clears it, so picking the same file again still fires onChange.
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const assign = useMutation(trpc.project.assign.mutationOptions({ onSuccess: refresh }));
  const addQuote = useMutation(
    trpc.project.addQuote.mutationOptions({
      // A sent quote clears the form, so a second click cannot send it again.
      onSuccess: async () => {
        setQuoteRows([{ ...EMPTY_ROW }]);
        setDeliveryDays("14");
        await refresh();
      },
    }),
  );
  const proposeAmendment = useMutation(trpc.project.proposeAmendment.mutationOptions({ onSuccess: refresh }));
  const offerPaidRevision = useMutation(trpc.project.offerPaidRevision.mutationOptions({ onSuccess: refresh }));
  function removeDeliveryFile() {
    setDeliveryFile(null);
    setFileInputKey((key) => key + 1);
  }
  const deliver = useMutation({
    mutationFn: async (draft: { note: string; link: string; file: File | null }) => {
      let fileUploadId: string | undefined;
      if (draft.file) {
        const file = draft.file;
        const upload = await trpcClient.project.deliveryUploadStart.mutate({ teamSlug, projectId, fileName: file.name, sizeBytes: file.size });
        setUploadProgress(0);
        try {
          await uploadToPresignedUrl({ url: upload.url, headers: upload.headers, file, onProgress: setUploadProgress });
        } finally {
          setUploadProgress(null);
        }
        fileUploadId = upload.uploadId;
      }
      return trpcClient.project.deliver.mutate({ teamSlug, projectId, note: draft.note, link: draft.link, fileUploadId });
    },
    onSuccess: () => {
      setDeliveryNote("");
      setDeliveryLink("");
      removeDeliveryFile();
      return refresh();
    },
  });

  if (detail.isPending) return <Loader />;
  // Keep the last data for a temporary failure, but never display it after the server revokes the read.
  if (!detail.data || isProjectReadDenied(detail.error)) {
    const missing = isNotFoundError(detail.error);
    const signIn = detail.error?.data?.code === "UNAUTHORIZED";
    const allowedPages = new Set((seller.data?.scope?.seller?.sections ?? []).flatMap((section) => section.pages));
    const back = allowedPages.has("projects")
      ? { href: `/${teamSlug}/projects`, label: "Back to projects" }
      : allowedPages.has("requests")
        ? { href: `/${teamSlug}/requests`, label: "Back to requests" }
        : { href: `/${teamSlug}`, label: "Back to Home" };
    return (
      <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-7 md:py-8">
        <h1 className="font-heading text-3xl">{missing ? "Project not found" : signIn ? "Sign in to view this project" : "Project unavailable"}</h1>
        <p className="text-sm text-muted-foreground">{missing ? "This project is no longer available to you." : isProjectReadDenied(detail.error) ? "Your access may have changed." : "The project couldn’t be loaded. Try again without leaving this page."}</p>
        {!isProjectReadDenied(detail.error) ? <Button type="button" variant="outline" onClick={() => void detail.refetch()}>Try again</Button> : null}
        {signIn ? <Link href="/login" className={"block text-sm underline underline-offset-4"}>Sign in</Link> : null}
        <Link href={back.href} className="underline">
          {back.label}
        </Link>
      </main>
    );
  }

  const {
    project,
    contacts,
    quotes,
    amendments,
    payments,
    deliveries,
    refund,
    dispute,
    marks,
    schedule,
    financesHidden,
    revisionRounds,
    qualityRefundCapMinor,
    role,
    quotingMode,
    solo,
    viewerId,
    quoteCalculator,
  } = detail.data;
  const currency = project.currency;
  const primary = contacts.find((c) => c.isPrimary);
  const primaryEmail = primary?.identities.find((i) => i.kind === "email")?.value;
  const currentQuote = quotes.find((q) => q.status === "accepted");
  const pendingAmendment = amendments.find((a) => a.status === "pending");
  const days = Number(deliveryDays);
  const quoteItems = parseRows(quoteRows);
  const author = quoteAuthor({
    role,
    actorId: viewerId,
    quotingMode,
    solo,
    assignedFreelancerId: project.assignedFreelancerId,
    freelancerId: quoteFreelancerId || null,
  });
  const canQuote = project.status === "quoting" && author.ok;
  // Staff name the freelancer in team mode and in open mode; only assigned mode implies them.
  // A solo seller always quotes as themselves.
  const needsFreelancerName = !solo && role !== "freelancer" && quotingMode !== "assigned";
  const canDeliver =
    project.status === "in_progress" &&
    canSubmitDelivery({ role, actorId: viewerId, assignedFreelancerId: project.assignedFreelancerId });
  const deliveryProblem = deliveryDraftProblem({
    note: deliveryNote,
    link: deliveryLink,
    file: deliveryFile ? { name: deliveryFile.name, size: deliveryFile.size } : null,
  });
  // An untouched form only disables the button; the hint appears once something is typed or picked.
  const deliveryDraftTouched = deliveryNote !== "" || deliveryLink !== "" || deliveryFile !== null;
  const deliveryHint = deliveryDraftTouched ? deliveryProblem : null;

  function handleAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (freelancerId) assign.mutate({ teamSlug, projectId, freelancerId });
  }

  function handleQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quoteItems || !Number.isInteger(days) || days < 1 || !canQuote) return;
    const quote: QuoteInput = { teamSlug, projectId, items: quoteItems, deliveryDays: days };
    if (quoteFreelancerId) quote.freelancerId = quoteFreelancerId;
    addQuote.mutate(quote);
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
    deliver.mutate({ note: deliveryNote, link: deliveryLink, file: deliveryFile });
  }

  const next = project.status === "quoting"
    ? { title: "Review the request and prepare a quote", tab: financesHidden ? "conversation" : "quote", action: financesHidden ? "Open conversation" : "Open quote" }
    : project.status === "in_progress" || project.status === "delivered"
      ? { title: project.status === "delivered" ? "Waiting for the client to review the delivery" : "Prepare the next delivery", tab: "delivery", action: "Open delivery" }
      : project.status === "awaiting_deposit" || project.status === "awaiting_balance"
        ? { title: project.status === "awaiting_deposit" ? "Waiting for the client’s deposit" : "Waiting for the client’s balance payment", tab: financesHidden ? "conversation" : "money", action: financesHidden ? "Open conversation" : "View finances" }
        : { title: "Review the project’s latest activity", tab: "conversation", action: "Open conversation" };

  const isFormView = view === "quote" || view === "delivery";
  const projectRail = (
    <ContextRail label="Project context">
      {view === "activity" ? <ProjectRatings key={projectId} teamSlug={teamSlug} projectId={projectId} ratings={detail.data.ratings} onChanged={refresh} /> : null}
      {view === "activity" ? <MemberMarks teamSlug={teamSlug} project={project} marks={marks} role={role} onChanged={refresh} /> : null}
      {view !== "activity" && !isFormView ? <section className="space-y-2 border-b pb-5" aria-labelledby="project-people-heading">
        <h2 id="project-people-heading" className="text-sm font-semibold">People</h2>
        <dl className="divide-y text-xs">
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 py-2"><dt className="text-muted-foreground">Assigned to</dt><dd className="break-words">{members.data?.find((member) => member.id === project.assignedFreelancerId)?.name ?? "Not assigned"}</dd></div>
        </dl>
      </section> : null}
      {view !== "activity" && !financesHidden ? <section className="space-y-2 border-b pb-5" aria-labelledby="project-glance-heading">
        <h2 id="project-glance-heading" className="text-sm font-semibold">At a glance</h2>
        <dl className="divide-y text-xs">
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 py-2"><dt className="text-muted-foreground">Quotes</dt><dd className="font-tabular">{quotes.length}</dd></div>
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 py-2"><dt className="text-muted-foreground">Deliveries</dt><dd className="font-tabular">{deliveries.length}</dd></div>
        </dl>
      </section> : null}
      {view !== "activity" && seller.data?.available ? <Link href={`/${teamSlug}/threads?project=${projectId}`} className="flex items-start gap-2.5 rounded-[10px] bg-secondary/70 p-3 text-xs hover:bg-accent">
        <span className="grid min-w-0 gap-0.5"><strong className="break-words font-semibold">Ask about {project.title}</strong><span className="text-muted-foreground">Open a focused thread for this project.</span></span>
      </Link> : null}
      {view === "overview" && schedule.length > 0 ? (
        <section id="scheduled" className="scroll-mt-4 space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Scheduled</h2>
            <p className="text-sm text-muted-foreground">These run on their own.</p>
          </div>
          <ul className="panel divide-y text-sm">
            {schedule.map((item) => (
              <li key={item.kind} className="flex items-baseline justify-between gap-4 px-3.5 py-2.5">
                <span>{scheduleLabel(item.kind)}</span>
                <span className="shrink-0 text-right text-muted-foreground">{scheduleWhen(item)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </ContextRail>
  );

  return (
    <WorkPage rail={projectRail}>
      <div className="min-w-0 space-y-2">
        <h1 className="break-words font-heading text-3xl">{project.title}</h1>
        {detail.isError ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] border p-3 text-sm">
          <p className="min-w-0 flex-1">Couldn’t refresh this project. You’re viewing the last loaded version.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void detail.refetch()}>Try again</Button>
        </div> : null}
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge tone={TEAM_PROJECT_TONES[project.status]}>
            {projectStatusLabel(project.status)}
          </Badge>
          {primary?.name ?? "No client"}
        </p>
        {view === "overview" ? <div className="max-w-3xl pt-2">
          <ProjectProgress status={project.status} layout="row" paidUpfront={project.upfrontBps === 10_000} />
        </div> : null}
        <PreparedBanner teamId={project.teamId} projectId={project.id} slug={teamSlug} />
        {dispute ? <DisputeCard dispute={dispute} currency={currency} paypalEnvironment={paypalEnvironment} /> : null}
        {!financesHidden && (view === "overview" || view === "money") ? <LateRefundNotice teamSlug={teamSlug} project={project} role={role} onChanged={refresh} /> : null}
      </div>

      {view !== "money" ? <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8">
      {view === "overview" ? <section className="space-y-4" aria-labelledby="project-next-heading">
        <h2 id="project-next-heading" className="font-heading text-lg">What happens next</h2>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border p-4">
          <p className="min-w-0 flex-1 basis-full text-sm font-medium sm:basis-auto">{next.title}</p>
          <Link href={`/${teamSlug}/projects/${projectId}/${next.tab}`} className="shrink-0 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent">{next.action}</Link>
        </div>
      </section> : null}
        {view === "overview" && project.source === "web" ? (
          <section id="request" className="scroll-mt-4 space-y-3 pt-3">
            <h2 className="text-lg font-semibold">Request</h2>
            {primary ? (
            <p className="text-sm">
              Requested by{" "}
              {primaryEmail ? `${primary.name} <${primaryEmail}>` : primary.name}
            </p>
            ) : null}
            {project.requestAnswers.length > 0 ? (
              <dl className="space-y-2">
                {project.requestAnswers.map((qa, index) => (
                  <div key={index}>
                    <dt className="text-sm font-medium">{qa.question}</dt>
                    <dd className="text-sm whitespace-pre-wrap">{qa.answer}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>
        ) : null}
        {view === "overview" && project.brief ? <section className="space-y-3"><h2 className="font-heading text-lg">The work</h2><p className="break-words text-sm leading-relaxed">{project.brief}</p></section> : null}
      {view === "conversation" ? <ConversationSection teamSlug={teamSlug} detail={detail.data} members={members.data ?? []} onChange={refresh} /> : null}
      {view === "activity" && contacts.length > 0 ? (
      <ClientsSection teamSlug={teamSlug} projectId={projectId} contacts={contacts} role={role} onChange={refresh} />
      ) : null}

      {view === "activity" && !solo && canAssignFreelancer(role) && project.status === "quoting" ? (
        <section id="assignment" className="scroll-mt-4 space-y-3">
          <h2 className="text-lg font-semibold">Assignment</h2>
          <form onSubmit={handleAssign} className="flex flex-wrap items-end gap-2">
            <div className="space-y-2">
              <Label htmlFor="assign-freelancer">Freelancer</Label>
              <select
                id="assign-freelancer"
                className={nativeSelectClass}
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

      {view !== "quote" || financesHidden ? null : (
      <section id="quotes" className="scroll-mt-4 space-y-3">
        <h2 className="text-lg font-semibold">Quotes</h2>
        {competingProposalCount(quotes) > 1 ? <p className="text-sm text-muted-foreground">{competingProposalCount(quotes)} freelancers sent competing proposals. The client accepts one; the others are closed.</p> : null}
        {quotes.length === 0 ? <p className="text-sm text-muted-foreground">No quotes yet.</p> : null}
        {quotes.map((quote) => (
          <QuoteCard key={quote.id} quote={quote} currency={currency} members={members.data ?? []} />
        ))}
        {project.status === "quoting" && (role !== "freelancer" || quotingMode !== "team") ? (
          <form onSubmit={handleQuote} className="space-y-3 panel p-4">
            <h3 className="font-medium">New quote</h3>
            <ItemRowsEditor rows={quoteRows} onChange={setQuoteRows} currency={currency} />
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="delivery-days">Delivery days</Label>
                <ValueInput id="delivery-days" unit="days" type="number" min={1} step={1} inputMode="numeric" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} />
              </div>
              {needsFreelancerName ? (
                <div className="space-y-2">
                  <Label htmlFor="quote-freelancer">Freelancer</Label>
                  <select
                    id="quote-freelancer"
                    className={nativeSelectClass}
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
            {/* A solo seller keeps the whole price, so there is no member share to work out. */}
            {!solo ? (
              <QuoteCalculator
                rates={{
                  currency,
                  teamCutBps: project.teamCutBps,
                  managementFeeBps: project.managementFeeBps,
                  ...quoteCalculator,
                }}
                onUseQuote={
                  quoteRows.length === 1
                    ? (quoteMinor) => setQuoteRows((rows) => rows.map((row) => ({ ...row, amount: minorToPriceInput(quoteMinor) })))
                    : null
                }
              />
            ) : null}
            {/* Without this, Send quote stays disabled with no reason given (for example, nobody assigned yet). */}
            {!author.ok ? <p className="text-sm text-muted-foreground">{quoteAuthorRefusalMessage(author.reason)}</p> : null}
            {addQuote.error ? <p className="text-sm text-destructive">{addQuote.error.message}</p> : null}
          </form>
        ) : null}
      </section>
      )}

      {view !== "quote" || financesHidden ? null : (
      <section id="amendments" className="scroll-mt-4 space-y-3">
        <h2 className="text-lg font-semibold">Amendments</h2>
        {revisionRounds && revisionRounds.used >= revisionRounds.allowed && revisionRounds.paidPriceMinor > 0 && project.status === "delivered" && !pendingAmendment ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              The client used {revisionRounds.used} of {revisionRounds.allowed} free rounds of changes.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={offerPaidRevision.isPending}
              onClick={() => offerPaidRevision.mutate({ teamSlug, projectId })}
            >
              Offer paid revision (+{formatMoney(money(currency, revisionRounds.paidPriceMinor))}, +1 revision)
            </Button>
            {offerPaidRevision.error ? (
              <p role="alert" className="text-sm text-destructive">
                {offerPaidRevision.error.message}
              </p>
            ) : null}
          </div>
        ) : null}
        {amendments.length === 0 ? <p className="text-sm text-muted-foreground">No amendments.</p> : null}
        {amendments.map((amendment) => (
          <div key={amendment.id} className="panel p-4 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {amendment.deltaMinor > 0 ? "+" : ""}
                {formatMoney(money(currency, amendment.deltaMinor))} → {formatMoney(money(currency, amendment.newAmountMinor))}
              </p>
              <Badge tone={amendment.status === "accepted" ? "good" : "neutral"}>{AMENDMENT_STATUS_LABELS[amendment.status] ?? amendment.status}</Badge>
            </div>
            {amendment.note ? <p className="mt-1">{amendment.note}</p> : null}
          </div>
        ))}
        {(project.status === "in_progress" || project.status === "delivered") &&
        !pendingAmendment &&
        canProposeAmendment({ role, actorId: viewerId, assignedFreelancerId: project.assignedFreelancerId }) &&
        currentQuote ? (
          <form onSubmit={handleAmend} className="space-y-3 panel p-4">
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
            {addRows.length > 0 ? <ItemRowsEditor rows={addRows} onChange={setAddRows} currency={currency} /> : null}
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
      )}

      {view === "delivery" ? <section id="deliveries" className="scroll-mt-4 space-y-3">
        <h2 className="text-lg font-semibold">Deliveries</h2>
        {deliveries.length === 0 ? <p className="text-sm text-muted-foreground">No deliveries yet.</p> : null}
        {newestFirst(deliveries).map((delivery) => (
          <div key={delivery.id} className="space-y-2 panel p-4 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium">Delivered {new Date(delivery.createdAt).toLocaleString()}</p>
              <span className="text-muted-foreground">{deliveryStaffStatusLabel(delivery.status)}</span>
            </div>
            {delivery.note ? <p className="whitespace-pre-wrap">{delivery.note}</p> : null}
            <DeliveryLink link={delivery.link} />
            {delivery.file ? (
              <DeliveryFile
                file={delivery.file}
                getUrl={async () => (await trpcClient.project.deliveryFileUrl.query({ teamSlug, projectId, deliveryId: delivery.id })).url}
              />
            ) : null}
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
          <form onSubmit={handleDeliver} className="space-y-3 panel p-4">
            <h3 className="font-medium">Deliver</h3>
            <fieldset disabled={deliver.isPending} className="min-w-0 space-y-3">
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
              <div className="space-y-2">
                <Label htmlFor="delivery-file">File (optional)</Label>
                <Input
                  key={fileInputKey}
                  id="delivery-file"
                  type="file"
                  accept={FILE_ACCEPT}
                  aria-describedby={deliveryHint ? "delivery-problem" : undefined}
                  onChange={(e) => setDeliveryFile(e.target.files?.[0] ?? null)}
                />
                {deliveryFile ? (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      {deliveryFile.name} ({formatBytes(deliveryFile.size)})
                    </span>
                    <Button type="button" variant="outline" size="sm" onClick={removeDeliveryFile}>
                      Remove file
                    </Button>
                  </div>
                ) : null}
              </div>
              <Button type="submit" disabled={deliveryProblem !== null || deliver.isPending}>
                {deliver.isPending && uploadProgress === null ? "Saving…" : "Submit delivery"}
              </Button>
            </fieldset>
            {uploadProgress !== null ? (
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Uploading… {Math.round(uploadProgress * 100)}%</p>
                <progress aria-label="Upload progress" max={1} value={uploadProgress} className="w-full" />
              </div>
            ) : null}
            {/* Always mounted so screen readers pick up the message when it appears. */}
            <p id="delivery-problem" aria-live="polite" className="text-sm text-destructive empty:hidden">
              {deliveryHint}
            </p>
            {deliver.error ? (
              <p ref={focusOnMount} role="alert" tabIndex={-1} className="text-sm text-destructive outline-none">
                {deliver.error.message}
              </p>
            ) : null}
          </form>
        ) : null}
      </section> : null}

      {view === "quote" && financesHidden ? <p className="text-sm text-muted-foreground">Project prices aren’t available with your current access.</p> : null}

      </div> : null}

      {view === "money" ? <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8">
      {financesHidden ? null : (
      <>
      <section aria-label="Payment totals" className="space-y-3 rounded-[10px] border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Finances</h2>
          <p className="text-sm text-muted-foreground">{primary?.name ?? "No client"} · {currency}</p>
        </div>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-muted-foreground">Paid so far</dt><dd className="font-tabular text-base font-medium">{formatMoney(money(currency, payments.filter((payment) => payment.status === "captured").reduce((sum, payment) => sum + payment.amountMinor, 0)))}</dd></div>
          <div><dt className="text-muted-foreground">Waiting to be paid</dt><dd className="font-tabular text-base font-medium">{formatMoney(money(currency, payments.filter((payment) => payment.status === "pending").reduce((sum, payment) => sum + payment.amountMinor, 0)))}</dd></div>
        </dl>
      </section>
      <section id="payments" className="scroll-mt-4 space-y-3">
        <h2 className="text-lg font-semibold">Payments</h2>
        {payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet. The deposit is created when the client accepts a quote.</p> : null}
        {payments.map((payment) => (
          <article key={payment.id} data-financial-document className="rounded-lg border px-5 py-6 text-sm sm:px-7 sm:py-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h3 className="font-heading text-lg">{PAYMENT_KIND_LABELS[payment.kind]} payment</h3>
              <div className="flex items-center gap-2">
                {payment.reviewReason ? (
                  <Badge tone="warn">Needs review</Badge>
                ) : null}
                <Badge tone={payment.status === "captured" ? "good" : payment.status === "failed" ? "fail" : "neutral"}>{paymentRefundLabel(payment, currency) ?? PAYMENT_STATUS_LABELS[payment.status]}</Badge>
              </div>
            </div>
            <p className="mt-3 break-all text-xs text-muted-foreground">Reference: {payment.id}</p>
            {payment.lines.some((line) => line.label.startsWith("Management fee")) ? <p className="mt-2 text-xs text-muted-foreground">The management fee is calculated on the quoted work subtotal.</p> : null}
            <div className="mt-6">
              <ul className="divide-y border-y">
                {payment.lines.map((line, index) => (
                  <li key={index} className="flex justify-between gap-4 py-4">
                    <span>{line.label}</span>
                    <span className="shrink-0 whitespace-nowrap font-tabular">{formatMoney(money(currency, line.amountMinor))}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-5 flex items-baseline justify-between gap-4"><dt className="font-medium">{payment.status === "captured" ? "Total paid" : payment.status === "pending" ? "Amount due" : "Payment total"}</dt><dd className="shrink-0 whitespace-nowrap font-tabular text-xl font-semibold">{formatMoney(money(currency, payment.amountMinor))}</dd></dl>
              {payment.status === "pending" ? <p className="mt-2 text-muted-foreground">Waiting for the client to pay.</p> : null}
            </div>
          </article>
        ))}
      </section>
      </>
      )}
      {!financesHidden && refund ? (
        <RefundSection
          teamSlug={teamSlug}
          projectId={projectId}
          refund={refund}
          payments={payments}
          role={role}
          clientName={primary?.name ?? "the client"}
          onRefunded={refresh}
        />
      ) : null}
      {!financesHidden ? <QualityRefundForm teamSlug={teamSlug} project={project} role={role} capMinor={qualityRefundCapMinor} onChanged={refresh} /> : null}
      {financesHidden ? <p className="text-sm text-muted-foreground">Project finances aren’t available with your current access.</p> : null}
      </div> : null}

    </WorkPage>
  );
}
