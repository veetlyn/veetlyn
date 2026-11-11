"use client";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import { formatMoney, money, projectAllows, projectStatusLabel } from "@jendal-workspace/core";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { cn } from "@jendal-workspace/ui/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import { type FormEvent, useState } from "react";

import { Composer, ConversationThread } from "@/components/conversation/thread";
import { DeliveryFile } from "@/components/delivery-file";
import { ProjectProgress } from "@/components/project-progress";
import { DeliveryLink } from "@/components/delivery-link";
import { DeliveryNote } from "@/components/delivery-note";
import { clientRefundLabel, paymentRefundLabel } from "@/lib/client-refund";
import { deliveryStatusLabel, MAX_DELIVERY_NOTE, newestFirst } from "@/lib/delivery";
import {
  AMENDMENT_STATUS_LABELS,
  CLIENT_PROJECT_TONES,
  PAYMENT_KIND_LABELS,
  PAYMENT_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
} from "@/lib/status-labels";
import { deliveryTimingLabel, formatDay, formatWhen, managementFeeLabel, paidSummary } from "@/lib/project-money";

export type ClientProjectData = inferRouterOutputs<AppRouter>["project"]["clientGet"];

// What the client can do from the page. A preview passes none: the page renders with its buttons disabled.
export type ClientProjectActions = {
  acceptQuote: (quoteId: string) => void;
  acceptAmendment: (amendmentId: string) => void;
  declineAmendment: (amendmentId: string) => void;
  acceptDelivery: (deliveryId: string) => void;
  requestChanges: (deliveryId: string, note: string) => Promise<void>;
  resetDelivery: () => void;
  quoteBusy: boolean;
  amendmentBusy: boolean;
  deliveryBusy: boolean;
  deliveryError: { message: string } | null;
  actionError: { message: string } | null;
  post: (draft: { body: string; teamOnly: boolean }) => Promise<void>;
  answer: (questionId: string, body: string) => Promise<void>;
  messageBusy: boolean;
  messageError: { message: string } | null;
  review: (rating: number, body: string) => Promise<void>;
  reviewBusy: boolean;
  reviewError: { message: string } | null;
};

type Quote = ClientProjectData["quotes"][number];
type ConversationMessage = ClientProjectData["conversation"]["messages"][number];

// Responses grouped by freelancer (conversations design §7): each one's quote and questions together.
function responsesByFreelancer(quotes: readonly Quote[], messages: readonly ConversationMessage[]) {
  const groups = new Map<string, { name: string; quotes: Quote[]; questions: ConversationMessage[] }>();
  const group = (freelancer: { key: string; name: string }) => {
    const found = groups.get(freelancer.key) ?? { name: freelancer.name, quotes: [], questions: [] };
    groups.set(freelancer.key, found);
    return found;
  };
  for (const quote of quotes) if (quote.freelancer) group(quote.freelancer).quotes.push(quote);
  for (const message of messages) {
    if (message.kind === "question" && message.freelancer) group(message.freelancer).questions.push(message);
  }
  return [...groups.entries()];
}

function AnswerBox({
  question,
  answered,
  actions,
}: {
  question: ConversationMessage;
  answered: boolean;
  actions: ClientProjectActions | null;
}) {
  const [body, setBody] = useState("");
  if (answered) return <p className="text-sm text-muted-foreground">Answered.</p>;
  return (
    <form
      className="grid gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!actions || !body.trim()) return;
        try {
          await actions.answer(question.id, body.trim());
          setBody("");
        } catch {
          // The page shows the error; the answer stays typed.
        }
      }}
    >
      <Label htmlFor={`answer-${question.id}`}>Your answer</Label>
      <Textarea
        id={`answer-${question.id}`}
        rows={2}
        maxLength={4000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <Button
        type="submit"
        variant="outline"
        className="justify-self-start"
        disabled={!actions || actions.messageBusy || !body.trim()}
      >
        Send answer
      </Button>
    </form>
  );
}

function QuoteSummary({
  quote,
  currency,
  quoting,
  upfrontBps,
  actions,
}: {
  quote: Quote;
  currency: ClientProjectData["project"]["currency"];
  quoting: boolean;
  upfrontBps: number;
  actions: ClientProjectActions | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="grid gap-0.5">
          <span className="font-tabular text-xl font-semibold">{formatMoney(money(currency, quote.amountMinor))}</span>
          <span className="text-sm text-muted-foreground">Delivery {deliveryTimingLabel(quote.deliveryDays, upfrontBps)}</span>
        </p>
        <Badge tone={quote.status === "proposed" && quoting ? "brand" : quote.status === "accepted" ? "good" : "neutral"}>
          {quote.status === "proposed" ? (quoting ? "Waiting for you" : "Not taken") : QUOTE_STATUS_LABELS[quote.status]}
        </Badge>
      </div>
      <ul className="space-y-1 text-sm">
        {quote.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-4">
            <span>{item.description}</span>
            <span>{formatMoney(money(currency, item.amountMinor))}</span>
          </li>
        ))}
      </ul>
      {quote.status === "proposed" && quoting ? (
        <Button variant="mint" disabled={!actions || actions.quoteBusy} onClick={() => actions?.acceptQuote(quote.id)}>
          Accept quote
        </Button>
      ) : null}
    </div>
  );
}

// A section of the client's page: a frame panel with its title in the head row and its content inset.
function Frame({
  id,
  title,
  aside,
  children,
}: {
  id?: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-label={title} className="frame frame-panel scroll-mt-4">
      <div className="frame-head justify-between text-[13px]">
        <h2 className="font-medium">{title}</h2>
        {aside}
      </div>
      <div className="frame frame-body grid gap-4 p-4">{children}</div>
    </section>
  );
}

const STAR_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"] as const;

// P design §1: the client of a completed project rates the seller once, and may change it for 30 days.
function ReviewSection({ data, actions }: { data: ClientProjectData; actions: ClientProjectActions | null }) {
  const { review } = data;
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(review.review?.rating ?? 0);
  const [body, setBody] = useState(review.review?.body ?? "");
  if (data.project.status !== "completed") return null;
  const posted = review.review;
  const writing = review.canReview && actions !== null && (!posted || editing);
  return (
    <Frame id="review" title={posted ? "Your review" : "How did it go?"}>
      {review.problem ? <p className="text-sm text-muted-foreground">{review.problem}</p> : null}
      {posted && !writing ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium" aria-label={`${posted.rating} out of 5 stars`}>
            {"★".repeat(posted.rating)}
            <span className="text-muted-foreground">{"★".repeat(5 - posted.rating)}</span> {STAR_WORDS[posted.rating]}
          </p>
          {posted.body ? <p className="text-sm whitespace-pre-line">{posted.body}</p> : null}
          <p className="text-xs text-muted-foreground">
            Shown on the seller&apos;s page with your first name and initial.{" "}
            {posted.editable ? `You can change it until ${new Date(posted.editableUntil).toLocaleDateString()}.` : "It is now final."}
          </p>
          {posted.editable && review.canReview && actions ? (
            <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setEditing(true)}>
              Edit review
            </Button>
          ) : null}
        </div>
      ) : null}
      {writing ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (rating < 1) return;
            void actions.review(rating, body).then(() => setEditing(false), () => undefined);
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="text-sm">Rate the seller</legend>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5].map((stars) => (
                <label key={stars} className="cursor-pointer rounded-[8px] border px-3 py-1.5 text-sm has-checked:border-foreground has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
                  <input type="radio" name="stars" value={stars} checked={rating === stars} onChange={() => setRating(stars)} className="sr-only" />
                  {"★".repeat(stars)} <span className="text-muted-foreground">{STAR_WORDS[stars]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="grid gap-1.5 text-sm">
            <span>Review (optional, public)</span>
            <Textarea value={body} maxLength={1000} onChange={(event) => setBody(event.target.value)} placeholder="What went well, and what could be better?" />
          </label>
          <p className="text-xs text-muted-foreground">Shown on the seller&apos;s page with your first name and initial. Do not include personal or contact details.</p>
          {actions.reviewError ? <p role="alert" className="text-sm text-destructive">{actions.reviewError.message}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={rating < 1 || actions.reviewBusy}>
              {actions.reviewBusy ? "Posting…" : posted ? "Save review" : "Post review"}
            </Button>
            {posted ? (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </Frame>
  );
}

type NextStep = { title: string; detail: string; amount?: string; href?: string; target?: string; action?: string; pay?: boolean };

// The one thing waiting for the client (product principle 4: whose turn it is, with the money at the moment of
// decision), in the order the project needs them.
function nextStep(data: ClientProjectData): NextStep | null {
  const { project, quotes, amendments, payments, deliveries } = data;
  const currency = project.currency;
  const price = (minor: number) => formatMoney(money(currency, minor));
  const payment = payments.find((p) => p.payable);
  if (payment) {
    return {
      title: `Pay the ${PAYMENT_KIND_LABELS[payment.kind].toLowerCase()}`,
      detail: payment.processing
        ? "PayPal is still confirming this payment."
        : "You approve it in PayPal. The team starts or continues once it is paid.",
      amount: price(payment.amountMinor),
      href: payment.payPath ?? undefined,
      target: "payments",
      action: payment.processing ? "See payment status" : "Pay with PayPal",
      pay: !payment.processing,
    };
  }
  const proposed = quotes.filter((q) => q.status === "proposed");
  if (project.status === "quoting" && proposed.length > 0) {
    return {
      title: proposed.length === 1 ? "Accept the quote" : `Choose one of ${proposed.length} quotes`,
      detail: "Accepting asks you for the deposit next. Nothing is charged until you pay in PayPal.",
      amount: proposed.length === 1 && proposed[0] ? price(proposed[0].amountMinor) : undefined,
      target: "responses",
      action: proposed.length === 1 ? "See the quote" : "Compare quotes",
    };
  }
  // A pending amendment on a project that has ended (abandoned, cancelled) can no longer be answered.
  const amendment = projectAllows(project.status, "accept_amendment") ? amendments.find((a) => a.status === "pending") : undefined;
  if (amendment) {
    return {
      title: "Answer a change to the quote",
      detail: `New total ${price(amendment.newAmountMinor)} if you accept.`,
      amount: `${amendment.deltaMinor > 0 ? "+" : ""}${price(amendment.deltaMinor)}`,
      target: "amendments",
      action: "See the change",
    };
  }
  if (project.status === "delivered" && deliveries.some((d) => d.status === "submitted")) {
    return {
      title: "Review the delivery",
      detail: "Accept it, or ask for changes within your free rounds.",
      target: "delivery",
      action: "Review",
    };
  }
  if (project.status === "completed" && data.review.canReview && !data.review.review) {
    return {
      title: "Rate the seller",
      detail: "A few words help other clients choose. Your review is public with your first name and initial.",
      target: "review",
      action: "Rate",
    };
  }
  return null;
}

// The api prefixes rule refusals with a code for agents; people read the sentence after it.
const ERROR_CODE_PREFIX = /^[A-Z_]+: /;

type Delivery = ClientProjectData["deliveries"][number];

// Deliveries are numbered in the order they were sent; the accepted one of a finished project is the final one.
function deliveryTitle(position: number, count: number, accepted: boolean, completed: boolean): string {
  if (accepted && completed) return "Final delivery";
  return count > 1 ? `Delivery ${position}` : "Delivery";
}

const DELIVERY_TONES = { submitted: "brand", accepted: "good", changes_requested: "neutral" } as const satisfies Record<
  Delivery["status"],
  "brand" | "good" | "neutral"
>;

export function ClientProjectView({
  data,
  actions,
  fileUrl,
}: {
  data: ClientProjectData;
  actions: ClientProjectActions | null;
  fileUrl: (deliveryId: string) => Promise<string>;
}) {
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesNote, setChangesNote] = useState("");
  const { project, quotes, amendments, payments, deliveries, refund, conversation } = data;
  const closedRequest = project.status === "declined" || project.status === "expired";
  const completed = project.status === "completed";
  const responses = responsesByFreelancer(quotes, conversation.messages);
  const answeredIds = new Set(conversation.messages.filter((m) => m.kind === "answer").map((m) => m.replyToId));
  const currency = project.currency;
  const price = (minor: number) => formatMoney(money(currency, minor));
  const awaitingDelivery =
    project.status === "delivered" ? deliveries.find((d) => d.status === "submitted") : undefined;
  const deliveryBusy = !actions || actions.deliveryBusy;
  const changesNoteTooLong = changesNote.trim().length > MAX_DELIVERY_NOTE;
  const roundsUsed = project.revisionRounds !== null && project.revisionRounds.used >= project.revisionRounds.allowed;
  const sortedDeliveries = newestFirst(deliveries);
  const finalDelivery = completed ? sortedDeliveries.find((d) => d.status === "accepted") : undefined;
  const paid = paidSummary(payments);

  async function handleRequestChanges(event: FormEvent<HTMLFormElement>, deliveryId: string) {
    event.preventDefault();
    if (!actions || changesNote.trim() === "" || changesNoteTooLong || deliveryBusy) return;
    try {
      await actions.requestChanges(deliveryId, changesNote);
    } catch {
      // The form stays open; the page shows the mutation's error.
      return;
    }
    setChangesOpen(false);
    setChangesNote("");
  }

  const renderDelivery = (delivery: Delivery) => {
    const position = sortedDeliveries.length - sortedDeliveries.indexOf(delivery);
    return (
      <Frame
        key={delivery.id}
        title={deliveryTitle(position, sortedDeliveries.length, delivery.status === "accepted", completed)}
        aside={<Badge tone={DELIVERY_TONES[delivery.status]}>{deliveryStatusLabel(delivery.status)}</Badge>}
      >
        <p className="text-xs text-muted-foreground">
          Sent {formatWhen(delivery.createdAt)}
          {delivery.status === "accepted" && delivery.decidedAt ? ` · accepted ${formatWhen(delivery.decidedAt)}` : ""}
        </p>
        {/* What was handed over comes first; the note explains it. */}
        {delivery.file ? <DeliveryFile file={delivery.file} getUrl={() => fileUrl(delivery.id)} /> : null}
        <DeliveryLink link={delivery.link} className="text-sm" />
        {delivery.note ? <DeliveryNote note={delivery.note} className="text-sm" /> : null}
        {delivery.status === "changes_requested" && delivery.clientNote ? (
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium">Your request</p>
            <p className="whitespace-pre-wrap">{delivery.clientNote}</p>
          </div>
        ) : null}
        {awaitingDelivery?.id === delivery.id ? (
          changesOpen ? (
            <form onSubmit={(event) => handleRequestChanges(event, delivery.id)} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor={`changes-note-${delivery.id}`}>What should change?</Label>
                <Textarea
                  id={`changes-note-${delivery.id}`}
                  rows={4}
                  autoFocus
                  aria-describedby={changesNoteTooLong ? `changes-note-problem-${delivery.id}` : undefined}
                  value={changesNote}
                  onChange={(e) => setChangesNote(e.target.value)}
                />
              </div>
              {changesNoteTooLong ? (
                <p id={`changes-note-problem-${delivery.id}`} role="alert" className="text-sm text-destructive">
                  The note is too long.
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button type="submit" disabled={changesNote.trim() === "" || changesNoteTooLong || deliveryBusy}>
                  Send request
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={deliveryBusy}
                  onClick={() => {
                    actions?.resetDelivery();
                    setChangesOpen(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-2">
              {roundsUsed ? (
                <p className="text-sm text-muted-foreground">
                  You used your{" "}
                  {project.revisionRounds?.allowed === 1
                    ? "free round"
                    : `${project.revisionRounds?.allowed} free rounds`}{" "}
                  of changes.
                  {project.revisionRounds && project.revisionRounds.paidPriceMinor > 0
                    ? ` For more, ask the team for a paid revision (${price(project.revisionRounds.paidPriceMinor)}) in a message; it arrives as a change to the quote.`
                    : ""}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button variant="mint" disabled={deliveryBusy} onClick={() => actions?.acceptDelivery(delivery.id)}>
                  Accept delivery
                </Button>
                {roundsUsed ? null : (
                  <Button
                    variant="outline"
                    disabled={deliveryBusy}
                    onClick={() => {
                      actions?.resetDelivery();
                      setChangesOpen(true);
                    }}
                  >
                    Request changes
                  </Button>
                )}
              </div>
            </div>
          )
        ) : null}
        {awaitingDelivery?.id === delivery.id && actions?.deliveryError ? (
          <p role="alert" className="text-sm text-destructive">
            {actions.deliveryError.message.replace(ERROR_CODE_PREFIX, "")}
          </p>
        ) : null}
      </Frame>
    );
  };

  const requestSection =
    project.brief || project.rules ? (
      <Frame title="Your request">
        {project.brief ? <p className="text-sm whitespace-pre-wrap">{project.brief}</p> : null}
        {project.rules ? <p className="text-sm text-muted-foreground">Team rules: {project.rules}</p> : null}
      </Frame>
    ) : null;

  const responsesSection =
    responses.length > 0 ? (
      <section id="responses" aria-label="Responses" className="grid scroll-mt-4 gap-3">
        {responses.map(([key, response]) => (
          <Frame key={key} title={response.name}>
            {response.quotes.map((quote) => (
              <QuoteSummary
                key={quote.id}
                quote={quote}
                currency={currency}
                quoting={project.status === "quoting"}
                upfrontBps={project.upfrontBps}
                actions={actions}
              />
            ))}
            {response.questions.map((question) => (
              <div key={question.id} className="space-y-2 border-t pt-3">
                <p className="text-sm font-medium">Question</p>
                <p className="text-sm whitespace-pre-wrap">{question.body}</p>
                <AnswerBox
                  question={question}
                  answered={answeredIds.has(question.id)}
                  actions={conversation.canWrite ? actions : null}
                />
              </div>
            ))}
          </Frame>
        ))}
      </section>
    ) : null;

  const amendmentsSection =
    amendments.length > 0 ? (
      <section id="amendments" aria-label="Changes to the quote" className="grid scroll-mt-4 gap-3">
        {amendments.map((amendment) => (
          <Frame key={amendment.id} title="Change to the quote">
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {amendment.deltaMinor > 0 ? "+" : ""}
                {price(amendment.deltaMinor)} → new total {price(amendment.newAmountMinor)}
              </p>
              <span className="text-sm text-muted-foreground">
                {amendment.status === "pending"
                  ? "Waiting for you"
                  : (AMENDMENT_STATUS_LABELS[amendment.status] ?? amendment.status)}
              </span>
            </div>
            {amendment.addItems.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {amendment.addItems.map((item, index) => (
                  <li key={index} className="flex justify-between gap-4">
                    <span>+ {item.description}</span>
                    <span>{price(item.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {amendment.note ? <p className="text-sm">{amendment.note}</p> : null}
            {amendment.status === "pending" && projectAllows(project.status, "accept_amendment") ? (
              <div className="flex gap-2">
                <Button
                  variant="mint"
                  disabled={!actions || actions.amendmentBusy}
                  onClick={() => actions?.acceptAmendment(amendment.id)}
                >
                  Accept amendment
                </Button>
                <Button
                  variant="outline"
                  disabled={!actions || actions.amendmentBusy}
                  onClick={() => actions?.declineAmendment(amendment.id)}
                >
                  Decline
                </Button>
              </div>
            ) : null}
          </Frame>
        ))}
      </section>
    ) : null;

  const paymentFrames = payments.map((payment) => {
    const label = payment.processing
      ? "See payment status"
      : payment.status === "failed"
        ? "Try paying again"
        : "Pay with PayPal";
    return (
      <Frame
        key={payment.id}
        title={PAYMENT_KIND_LABELS[payment.kind]}
        aside={
          <span className="text-muted-foreground">
            {paymentRefundLabel(payment, currency) ?? PAYMENT_STATUS_LABELS[payment.status]}
          </span>
        }
      >
        <ul className="space-y-1 text-sm">
          {payment.lines.map((line, index) => (
            <li key={index} className="flex justify-between gap-4">
              <span>{line.label}</span>
              <span>{price(line.amountMinor)}</span>
            </li>
          ))}
          <li className="flex justify-between gap-4 border-t pt-2 font-semibold">
            <span>Total</span>
            <span className="font-tabular">{price(payment.amountMinor)}</span>
          </li>
        </ul>
        {payment.payPath ? (
          <a href={payment.payPath} className={buttonVariants({ variant: "mint", size: "lg" })}>
            {label}
          </a>
        ) : payment.payable ? (
          <Button variant="mint" size="lg" disabled>
            {label}
          </Button>
        ) : null}
      </Frame>
    );
  });

  const messagesSection = (
    <Frame id="messages" title="Messages">
      <ConversationThread
        messages={conversation.messages}
        isMine={(m) => m.authorKind === "client"}
        empty="No messages yet. Questions from the team show here and above, next to their quotes."
      />
      {conversation.canWrite && actions ? (
        <Composer
          audience={
            project.status === "quoting"
              ? "The freelancers looking at your request read this (contact details are hidden until you accept a quote)."
              : "Your freelancer and the team read this."
          }
          teamOnlyChoice={project.status === "quoting" ? "Send to the team only" : undefined}
          busy={actions.messageBusy}
          error={actions.messageError?.message ?? null}
          onSend={({ body, teamOnly }) => actions.post({ body, teamOnly })}
        />
      ) : null}
    </Frame>
  );

  const header = (
    <div className="space-y-2">
      <h1 className="font-heading text-[32px] leading-[1.1] tracking-[-0.03em]">{project.title}</h1>
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge tone={CLIENT_PROJECT_TONES[project.status]}>{projectStatusLabel(project.status)}</Badge>
        {/* The quoted work is not what the client pays: the management fee rides on top of it. A finished
            project shows the full money summary below instead. */}
        {project.finalPriceMinor !== null && !completed
          ? `Work subtotal ${price(project.finalPriceMinor)}${project.managementFeeBps > 0 ? ` · plus a ${project.managementFeeBps / 100}% management fee` : ""}`
          : ""}
      </p>
      {refund ? (
        <p className="text-sm font-medium">{clientRefundLabel(refund, (date) => date.toLocaleDateString())}</p>
      ) : null}
    </div>
  );

  // F08: a finished project answers "where is my work?" first; the records that led to it stay one click away.
  if (completed) {
    const earlier = sortedDeliveries.filter((d) => d !== finalDelivery);
    const step = nextStep(data);
    const hasRecords = requestSection || responsesSection || amendmentsSection;
    return (
      <div className="space-y-6">
        {header}
        <OutcomePanel
          acceptedAt={finalDelivery?.decidedAt ?? null}
          paidMinor={paid.paidMinor}
          price={price}
          hasDelivery={sortedDeliveries.length > 0}
          reviewStep={step?.target === "review" ? step : null}
        />

        {sortedDeliveries.length > 0 ? (
          <section id="delivery" aria-label="Delivery" className="grid scroll-mt-4 gap-3">
            {finalDelivery ? renderDelivery(finalDelivery) : null}
            {earlier.length > 0 ? (
              finalDelivery ? (
                <Disclosure summary={earlier.length === 1 ? "Earlier delivery" : `Earlier deliveries (${earlier.length})`}>
                  {earlier.map(renderDelivery)}
                </Disclosure>
              ) : (
                earlier.map(renderDelivery)
              )
            ) : null}
          </section>
        ) : null}

        {payments.length > 0 ? (
          <Frame id="payments" title="Payment">
            <dl className="divide-y text-sm">
              {project.finalPriceMinor !== null ? (
                <div className="flex justify-between gap-4 py-1.5">
                  <dt>Work subtotal</dt>
                  <dd className="font-tabular">{price(project.finalPriceMinor)}</dd>
                </div>
              ) : null}
              {paid.feePaidMinor > 0 ? (
                <div className="flex justify-between gap-4 py-1.5">
                  <dt>{managementFeeLabel(project.managementFeeBps)}</dt>
                  <dd className="font-tabular">{price(paid.feePaidMinor)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4 py-1.5 font-semibold">
                <dt>Total paid</dt>
                <dd className="font-tabular">{price(paid.paidMinor)}</dd>
              </div>
              {paid.refundedMinor > 0 ? (
                <div className="flex justify-between gap-4 py-1.5">
                  <dt>Refunded to you</dt>
                  <dd className="font-tabular">{price(paid.refundedMinor)}</dd>
                </div>
              ) : null}
              {paid.pendingMinor > 0 ? (
                <div className="flex justify-between gap-4 py-1.5">
                  <dt>Still to pay</dt>
                  <dd className="font-tabular">{price(paid.pendingMinor)}</dd>
                </div>
              ) : null}
            </dl>
            <Disclosure summary={payments.length === 1 ? "Payment receipt" : `Payment receipts (${payments.length})`}>
              {paymentFrames}
            </Disclosure>
          </Frame>
        ) : null}

        <ReviewSection data={data} actions={actions} />

        {hasRecords ? (
          <section aria-labelledby="records-heading" className="grid gap-3">
            <h2 id="records-heading" className="text-sm font-medium text-muted-foreground">
              Project records
            </h2>
            {requestSection ? <Disclosure summary="Your original request">{requestSection}</Disclosure> : null}
            {responsesSection ? <Disclosure summary={quotes.length === 1 ? "The quote" : `Quotes (${quotes.length})`}>{responsesSection}</Disclosure> : null}
            {amendmentsSection ? (
              <Disclosure summary={amendments.length === 1 ? "Change to the quote" : `Changes to the quote (${amendments.length})`}>
                {amendmentsSection}
              </Disclosure>
            ) : null}
          </section>
        ) : null}

        {messagesSection}
        {actions?.actionError ? <p className="text-sm text-destructive">{actions.actionError.message}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {closedRequest ? (
        <Frame
          title={
            project.status === "declined" ? "The team declined this request" : "This request expired without an answer"
          }
        >
          {project.declinedReason ? <p className="text-sm whitespace-pre-wrap">{project.declinedReason}</p> : null}
          <a href="/request" className={cn(buttonVariants({ variant: "outline" }), "justify-self-start")}>
            Send a new request
          </a>
        </Frame>
      ) : (
        <NextStepPanel step={nextStep(data)} status={project.status} preview={actions === null} />
      )}
      {!closedRequest && project.status !== "cancelled" ? (
        <ProjectProgress status={project.status} layout="row" paidUpfront={project.upfrontBps === 10_000} />
      ) : null}

      {requestSection}

      {responsesSection}

      {quotes.length === 0 && !closedRequest ? (
        <p className="text-sm text-muted-foreground">The team is preparing your quote.</p>
      ) : null}

      {amendmentsSection}

      {deliveries.length > 0 ? (
        <section id="delivery" aria-label="Delivery" className="grid scroll-mt-4 gap-3">
          {sortedDeliveries.map(renderDelivery)}
        </section>
      ) : null}

      {payments.length > 0 ? (
        <section id="payments" aria-label="Payments" className="grid scroll-mt-4 gap-3">
          {paymentFrames}
        </section>
      ) : null}

      <ReviewSection data={data} actions={actions} />

      {messagesSection}
      {actions?.actionError ? <p className="text-sm text-destructive">{actions.actionError.message}</p> : null}
    </div>
  );
}

// A labeled, closed-by-default container for records the client may need but rarely opens.
function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details>
      <summary className="cursor-pointer rounded-[8px] text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {summary}
      </summary>
      <div className="mt-3 grid gap-3">{children}</div>
    </details>
  );
}

// The top of a finished project: how it ended, from the records, and the way to the files. Nothing here is a
// pending duty; a review, when it can still be written, is named as optional.
function OutcomePanel({
  acceptedAt,
  paidMinor,
  price,
  hasDelivery,
  reviewStep,
}: {
  acceptedAt: Date | string | null;
  paidMinor: number;
  price: (minor: number) => string;
  hasDelivery: boolean;
  reviewStep: NextStep | null;
}) {
  const jump = (target: string) => document.getElementById(target)?.scrollIntoView({ block: "start" });
  return (
    <section aria-labelledby="outcome-heading" className="frame frame-panel">
      <h2 id="outcome-heading" className="frame-head text-[13px] font-medium">
        Project complete
      </h2>
      <div className="frame frame-body grid gap-4 p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">Your project is complete. Thank you.</p>
            <ul className="text-sm text-muted-foreground">
              {acceptedAt ? <li>You accepted the delivery on {formatDay(acceptedAt)}.</li> : null}
              {paidMinor > 0 ? <li>You paid {price(paidMinor)} in total.</li> : null}
            </ul>
          </div>
          {hasDelivery ? (
            <Button variant="outline" size="lg" onClick={() => jump("delivery")}>
              Go to your files
            </Button>
          ) : null}
        </div>
        {reviewStep ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-3">
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-medium">Optional: rate the seller.</span>{" "}
              <span className="text-muted-foreground">{reviewStep.detail}</span>
            </p>
            <Button variant="outline" onClick={() => jump("review")}>
              {reviewStep.action}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// The top of the client's page: what is waiting for them, with its amount and the one button that does it.
// "Your turn" is only said when something is actually waiting for the client.
function NextStepPanel({
  step,
  status,
  preview,
}: {
  step: NextStep | null;
  status: ClientProjectData["project"]["status"];
  preview: boolean;
}) {
  if (!step) {
    const ended = status === "cancelled" || status === "abandoned";
    return (
      <div className="frame frame-panel">
        <p className="frame-head text-[13px] font-medium">{ended ? "Project closed" : "Nothing needed from you"}</p>
        <p className="frame frame-body p-4 text-sm text-muted-foreground">
          {status === "cancelled"
            ? "This project was cancelled."
            : status === "abandoned"
              ? "This project closed before it finished."
              : "Nothing is waiting for you right now. The team will email you when it is your turn."}
        </p>
      </div>
    );
  }
  const jump = () =>
    step.target ? document.getElementById(step.target)?.scrollIntoView({ block: "start" }) : undefined;
  return (
    <div className="frame frame-panel">
      <p className="frame-head text-[13px] font-medium">Your turn</p>
      <div className="frame frame-body flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{step.title}</p>
          <p className="text-sm text-muted-foreground">{step.detail}</p>
        </div>
        {step.amount ? <p className="font-tabular text-2xl font-semibold tracking-[-0.02em]">{step.amount}</p> : null}
        {step.href && !preview ? (
          <a href={step.href} className={buttonVariants({ variant: "mint", size: "xl" })}>
            {step.action}
          </a>
        ) : step.action ? (
          <Button
            variant={step.pay ? "mint" : "outline"}
            size={step.pay ? "xl" : "lg"}
            onClick={jump}
            disabled={preview && step.pay}
          >
            {step.action}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
