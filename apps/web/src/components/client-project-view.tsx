"use client";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import { formatMoney, money, projectStatusLabel } from "@jendal-workspace/core";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import type { inferRouterOutputs } from "@trpc/server";
import { type FormEvent, useState } from "react";

import { Composer, ConversationThread } from "@/components/conversation/thread";
import { DeliveryFile } from "@/components/delivery-file";
import { ProjectProgress } from "@/components/project-progress";
import { DeliveryLink } from "@/components/delivery-link";
import { clientRefundLabel, paymentRefundLabel } from "@/lib/client-refund";
import { deliveryStatusLabel, MAX_DELIVERY_NOTE, newestFirst } from "@/lib/delivery";
import { AMENDMENT_STATUS_LABELS, CLIENT_PROJECT_TONES, PAYMENT_STATUS_LABELS, QUOTE_STATUS_LABELS } from "@/lib/status-labels";

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
      <Textarea id={`answer-${question.id}`} rows={2} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
      <Button type="submit" variant="outline" className="justify-self-start" disabled={!actions || actions.messageBusy || !body.trim()}>
        Send answer
      </Button>
    </form>
  );
}

function QuoteSummary({
  quote,
  currency,
  quoting,
  actions,
}: {
  quote: Quote;
  currency: ClientProjectData["project"]["currency"];
  quoting: boolean;
  actions: ClientProjectActions | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">
          <span className="font-tabular text-xl font-semibold">{formatMoney(money(currency, quote.amountMinor))}</span>
          <span className="text-muted-foreground"> · delivery in {quote.deliveryDays} days</span>
        </p>
        <Badge tone={quote.status === "proposed" ? "brand" : quote.status === "accepted" ? "good" : "neutral"}>
          {quote.status === "proposed" ? "Waiting for you" : QUOTE_STATUS_LABELS[quote.status]}
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
        <Button disabled={!actions || actions.quoteBusy} onClick={() => actions?.acceptQuote(quote.id)}>
          Accept quote
        </Button>
      ) : null}
    </div>
  );
}

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
  const responses = responsesByFreelancer(quotes, conversation.messages);
  const answeredIds = new Set(conversation.messages.filter((m) => m.kind === "answer").map((m) => m.replyToId));
  const currency = project.currency;
  const pendingPayments = payments.filter((p) => p.payable);
  const awaitingDelivery = project.status === "delivered" ? deliveries.find((d) => d.status === "submitted") : undefined;
  const deliveryBusy = !actions || actions.deliveryBusy;
  const changesNoteTooLong = changesNote.trim().length > MAX_DELIVERY_NOTE;

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

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">{project.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge tone={CLIENT_PROJECT_TONES[project.status]}>
            {projectStatusLabel(project.status)}
          </Badge>
          {project.finalPriceMinor !== null ? ` · Final price ${formatMoney(money(currency, project.finalPriceMinor))}` : ""}
        </p>
        {refund ? <p className="text-sm font-medium">{clientRefundLabel(refund, (date) => date.toLocaleDateString())}</p> : null}
        {project.brief ? <p className="text-sm">{project.brief}</p> : null}
        {project.rules ? <p className="text-sm text-muted-foreground">Team rules: {project.rules}</p> : null}
      </div>
      {closedRequest ? (
        <section className="panel space-y-2 p-4">
          <p className="font-medium">
            {project.status === "declined" ? "The team declined this request" : "This request expired without an answer"}
          </p>
          {project.declinedReason ? <p className="text-sm whitespace-pre-wrap">{project.declinedReason}</p> : null}
          <a href="/request" className={buttonVariants({ variant: "outline" })}>
            Send a new request
          </a>
        </section>
      ) : project.status !== "cancelled" ? (
        <ProjectProgress status={project.status} layout="row" />
      ) : null}

      {responses.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Responses</h2>
          {responses.map(([key, response]) => (
            <div key={key} className="space-y-3 panel p-4">
              <p className="font-medium">{response.name}</p>
              {response.quotes.map((quote) => (
                <QuoteSummary key={quote.id} quote={quote} currency={currency} quoting={project.status === "quoting"} actions={actions} />
              ))}
              {response.questions.map((question) => (
                <div key={question.id} className="space-y-2 border-t pt-3">
                  <p className="text-sm font-medium">Question</p>
                  <p className="text-sm whitespace-pre-wrap">{question.body}</p>
                  <AnswerBox question={question} answered={answeredIds.has(question.id)} actions={conversation.canWrite ? actions : null} />
                </div>
              ))}
            </div>
          ))}
        </section>
      ) : null}

      {quotes.length === 0 && !closedRequest ? (
        <p className="text-sm text-muted-foreground">The team is preparing your quote.</p>
      ) : null}

      {amendments.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Amendments</h2>
          {amendments.map((amendment) => (
            <div key={amendment.id} className="space-y-3 panel p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {amendment.deltaMinor > 0 ? "+" : ""}
                  {formatMoney(money(currency, amendment.deltaMinor))} → new total{" "}
                  {formatMoney(money(currency, amendment.newAmountMinor))}
                </p>
                <span className="text-sm text-muted-foreground">{amendment.status === "pending" ? "Waiting for you" : (AMENDMENT_STATUS_LABELS[amendment.status] ?? amendment.status)}</span>
              </div>
              {amendment.addItems.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {amendment.addItems.map((item, index) => (
                    <li key={index} className="flex justify-between gap-4">
                      <span>+ {item.description}</span>
                      <span>{formatMoney(money(currency, item.amountMinor))}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {amendment.note ? <p className="text-sm">{amendment.note}</p> : null}
              {amendment.status === "pending" ? (
                <div className="flex gap-2">
                  <Button
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
            </div>
          ))}
        </section>
      ) : null}

      {deliveries.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Delivery</h2>
          {newestFirst(deliveries).map((delivery) => (
            <div key={delivery.id} className="space-y-3 panel p-4">
              <div className="flex items-center justify-between text-sm">
                <p className="font-medium">Delivered {new Date(delivery.createdAt).toLocaleString()}</p>
                <span className="text-muted-foreground">{deliveryStatusLabel(delivery.status)}</span>
              </div>
              {delivery.note ? <p className="text-sm whitespace-pre-wrap">{delivery.note}</p> : null}
              <DeliveryLink link={delivery.link} className="text-sm" />
              {delivery.file ? <DeliveryFile file={delivery.file} getUrl={() => fileUrl(delivery.id)} /> : null}
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
                  {project.revisionRounds && project.revisionRounds.used >= project.revisionRounds.allowed ? (
                    <p className="text-sm text-muted-foreground">
                      You used your {project.revisionRounds.allowed} free rounds of changes.
                      {project.revisionRounds.paidPriceMinor > 0
                        ? ` Ask the team for a paid revision (${formatMoney(money(currency, project.revisionRounds.paidPriceMinor))}); it arrives as a change to the quote.`
                        : ""}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button disabled={deliveryBusy} onClick={() => actions?.acceptDelivery(delivery.id)}>
                      Accept delivery
                    </Button>
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
                  </div>
                  </div>
                )
              ) : null}
              {awaitingDelivery?.id === delivery.id && actions?.deliveryError ? (
                <p role="alert" className="text-sm text-destructive">
                  {actions.deliveryError.message}
                </p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {payments.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Payments</h2>
          {payments.map((payment) => {
            const label = payment.processing
              ? "See payment status"
              : payment.status === "failed"
                ? "Try paying again"
                : "Pay with PayPal";
            return (
              <div key={payment.id} className="space-y-3 panel p-4">
                <div className="flex items-center justify-between text-sm">
                  <p className="font-medium capitalize">{payment.kind.replace("_", "-")}</p>
                  <span className="text-muted-foreground">{paymentRefundLabel(payment, currency) ?? PAYMENT_STATUS_LABELS[payment.status]}</span>
                </div>
                <ul className="space-y-1 text-sm">
                  {payment.lines.map((line, index) => (
                    <li key={index} className="flex justify-between gap-4">
                      <span>{line.label}</span>
                      <span>{formatMoney(money(currency, line.amountMinor))}</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-4 font-medium">
                    <span>Total</span>
                    <span>{formatMoney(money(currency, payment.amountMinor))}</span>
                  </li>
                </ul>
                {payment.payPath ? (
                  <a href={payment.payPath} className={buttonVariants()}>
                    {label}
                  </a>
                ) : payment.payable ? (
                  <Button disabled>{label}</Button>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Messages</h2>
        <div className="panel grid gap-5 p-4">
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
        </div>
      </section>

      {project.status === "completed" ? (
        <p className="text-sm text-muted-foreground">This project is complete. Thank you.</p>
      ) : pendingPayments.length === 0 &&
        !awaitingDelivery &&
        quotes.every((q) => q.status !== "proposed") &&
        amendments.every((a) => a.status !== "pending") ? (
        <p className="text-sm text-muted-foreground">Nothing is waiting for you right now.</p>
      ) : null}
      {actions?.actionError ? <p className="text-sm text-destructive">{actions.actionError.message}</p> : null}
    </div>
  );
}
