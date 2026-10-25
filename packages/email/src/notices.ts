import type { EmailContent } from "./templates";
import { renderActionEmail } from "./templates";

// Notice emails for the outbox pipeline (AGT-16 and the member notices). Each builder takes the
// display facts already resolved by the dispatcher; no ids, only what the reader needs.

export type ClientNoticeKey =
  | "quote_sent"
  | "quote_amended"
  | "payment_requested"
  | "delivery_submitted"
  | "seller_replied"
  | "question_asked"
  | "request_declined"
  | "refund_pending"
  | "request_expired"
  | "review_reminder"
  | "project_auto_completed"
  | "project_abandoned"
  | "refund_issued";

type NoticeContext = { teamName: string; projectTitle: string; detail?: string };
type NoticeText = { subject: string; intro: string; action: string };
type NoticeBuilder = (ctx: NoticeContext) => NoticeText;

const CLIENT_NOTICES = new Map<ClientNoticeKey, NoticeBuilder>([
  ["question_asked", (c) => ({ subject: `A question from ${c.teamName}`, intro: `${c.teamName} has a question about "${c.projectTitle}". Answer it from your page:`, action: "Answer the question" })],
  ["request_declined", (c) => ({ subject: `Your request to ${c.teamName} was declined`, intro: `${c.teamName} declined the request for "${c.projectTitle}". Read the explanation on your page:`, action: "Read the reply" })],
  ["refund_pending", (c) => ({ subject: `Refund recorded for "${c.projectTitle}"`, intro: `${c.teamName} recorded a refund for "${c.projectTitle}". Check its status on your page; this notice does not confirm that it has been sent:`, action: "See the refund" })],
  ["quote_sent", (c) => ({
    subject: `Your quote from ${c.teamName}`,
    intro: `${c.teamName} sent a quote for "${c.projectTitle}"${c.detail ? `: ${c.detail}` : ""}. Read it and accept it, or ask for changes, on your page:`,
    action: "See the quote",
  })],
  ["quote_amended", (c) => ({
    subject: `Updated quote for "${c.projectTitle}"`,
    intro: `${c.teamName} updated the quote${c.detail ? ` (${c.detail})` : ""}. The new version is on your page:`,
    action: "See the new quote",
  })],
  ["payment_requested", (c) => ({
    subject: `Payment requested: ${c.detail ?? "your project"}`,
    intro: `${c.teamName} requests a payment for "${c.projectTitle}"${c.detail ? ` (${c.detail})` : ""}. Pay securely from your page:`,
    action: "Pay",
  })],
  ["delivery_submitted", (c) => ({
    subject: `Your delivery for "${c.projectTitle}"`,
    intro: `${c.teamName} delivered "${c.projectTitle}"${c.detail ? `: ${c.detail}` : ""}. Review it and accept it, or ask for changes, on your page:`,
    action: "Review the delivery",
  })],
  ["seller_replied", (c) => ({
    subject: `A reply on "${c.projectTitle}"`,
    intro: `${c.teamName} replied to your question about "${c.projectTitle}". Read the answer on your page:`,
    action: "Read the reply",
  })],
  ["request_expired", (c) => ({
    subject: `Your request to ${c.teamName} expired`,
    intro: `${c.teamName} did not answer your request for "${c.projectTitle}" in time, so it expired. You can send it again from their page whenever you like.`,
    action: "Start again",
  })],
  ["review_reminder", (c) => ({
    subject: `Waiting on you: "${c.projectTitle}"`,
    intro: `${c.teamName} delivered "${c.projectTitle}" and is waiting for your review${c.detail ? ` ${c.detail}` : ""}. Accept it or ask for changes on your page:`,
    action: "Review the delivery",
  })],
  ["project_auto_completed", (c) => ({
    subject: `"${c.projectTitle}" is complete`,
    intro: `The review window for "${c.projectTitle}" closed, so the delivery is accepted and the project is complete. Thank you for working with ${c.teamName}.`,
    action: "See the project",
  })],
  ["project_abandoned", (c) => ({
    subject: `"${c.projectTitle}" ended`,
    intro: `The review window for "${c.projectTitle}" closed without a reply, so the project ended per the terms you accepted. Payments already made stay settled.`,
    action: "See the project",
  })],
  ["refund_issued", (c) => ({
    subject: `Refund for "${c.projectTitle}"`,
    intro: `${c.teamName} refunded ${c.detail ?? "part of your payment"} for "${c.projectTitle}". It is on its way back to your payment method.`,
    action: "See the project",
  })],
]);

export function clientNoticeEmail(input: {
  platformName: string;
  name: string;
  teamName: string;
  projectTitle: string;
  key: ClientNoticeKey;
  detail?: string;
  url: string;
}): EmailContent {
  const text = CLIENT_NOTICES.get(input.key)?.({ teamName: input.teamName, projectTitle: input.projectTitle, detail: input.detail }) ?? {
    subject: `An update on "${input.projectTitle}"`,
    intro: `${input.teamName} posted an update on "${input.projectTitle}".`,
    action: "Open your page",
  };
  return renderActionEmail({
    platformName: input.platformName,
    subject: text.subject,
    name: input.name,
    intro: text.intro,
    action: text.action,
    url: input.url,
    outro: "Keep this email; the link is the way back to your page.",
  });
}

export type MemberNoticeKey =
  | "quote_request"
  | "client_message"
  | "client_question"
  | "quote_accepted"
  | "payment_paid"
  | "changes_requested"
  | "delivery_accepted"
  | "response_reminder"
  | "update_reminder"
  | "late_update_mark"
  | "strike_warning"
  | "leaving_notice"
  | "payout_update"
  | "dispute_opened";

const MEMBER_NOTICES = new Map<MemberNoticeKey, NoticeBuilder>([
  ["client_message", (c) => ({ subject: `A client reply on "${c.projectTitle}"`, intro: `The client posted a message on "${c.projectTitle}". Read it from the project page:`, action: "Read the reply" })],
  ["quote_request", (c) => ({
    subject: `New request: "${c.projectTitle}"`,
    intro: `${c.teamName} received a request${c.detail ? ` (${c.detail})` : ""}. Quote it before the response window closes:`,
    action: "Open the request",
  })],
  ["client_question", (c) => ({
    subject: `A question on "${c.projectTitle}"`,
    intro: `The client asked about "${c.projectTitle}". Answer from the project page:`,
    action: "Answer the client",
  })],
  ["quote_accepted", (c) => ({
    subject: `Your quote was accepted`,
    intro: `The client accepted the quote for "${c.projectTitle}". The work can start:`,
    action: "Start the work",
  })],
  ["payment_paid", (c) => ({
    subject: `Payment received`,
    intro: `The client paid ${c.detail ?? "a payment"} for "${c.projectTitle}".`,
    action: "See the project",
  })],
  ["changes_requested", (c) => ({
    subject: `Changes requested on "${c.projectTitle}"`,
    intro: `The client asked for changes on "${c.projectTitle}"${c.detail ? `: ${c.detail}` : ""}.`,
    action: "See the changes",
  })],
  ["delivery_accepted", (c) => ({
    subject: `Your delivery was accepted`,
    intro: `The client accepted the delivery for "${c.projectTitle}".`,
    action: "See the project",
  })],
  ["response_reminder", (c) => ({
    subject: `Answer soon: "${c.projectTitle}"`,
    intro: `The response window for the request "${c.projectTitle}" closes soon. Quote it or decline it before it expires:`,
    action: "Open the request",
  })],
  ["update_reminder", (c) => ({
    subject: `Post an update on "${c.projectTitle}"`,
    intro: `The update window for "${c.projectTitle}" closes soon. Post a short update so the client knows where things stand:`,
    action: "Post an update",
  })],
  ["late_update_mark", (c) => ({
    subject: `Missed update on "${c.projectTitle}"`,
    intro: `The update window for "${c.projectTitle}" closed without an update, so a mark was recorded on your profile.`,
    action: "See the project",
  })],
  ["strike_warning", (c) => ({
    subject: `Marks warning`,
    intro: `You collected several marks${c.detail ? ` (${c.detail})` : ""}. At the limit you are suspended from new requests; talk to your team's admin.`,
    action: "See your marks",
  })],
  ["leaving_notice", (c) => ({
    subject: `Your leaving notice`,
    intro: `Your leaving notice for ${c.teamName} was recorded${c.detail ? `; it ends ${c.detail}` : ""}. No new requests will reach you until then.`,
    action: "See your teams",
  })],
  ["payout_update", (c) => ({
    subject: `Your payout ${c.detail ?? "updated"}`,
    intro: `Your payout${c.projectTitle ? ` for "${c.projectTitle}"` : ""} changed status${c.detail ? `: ${c.detail}` : ""}.`,
    action: "See your payouts",
  })],
  ["dispute_opened", (c) => ({
    subject: `PayPal dispute on "${c.projectTitle}"`,
    intro: `A PayPal dispute was opened on "${c.projectTitle}"${c.detail ? ` (${c.detail})` : ""}. Timers and payouts for the project are paused until it resolves.`,
    action: "See the dispute",
  })],
]);

export function memberNoticeEmail(input: {
  platformName: string;
  name: string;
  teamName: string;
  projectTitle: string;
  key: MemberNoticeKey;
  detail?: string;
  url: string;
}): EmailContent {
  const text = MEMBER_NOTICES.get(input.key)?.({ teamName: input.teamName, projectTitle: input.projectTitle, detail: input.detail }) ?? {
    subject: `An update from ${input.teamName}`,
    intro: `${input.teamName} posted an update${input.projectTitle ? ` on "${input.projectTitle}"` : ""}.`,
    action: "Open the page",
  };
  return renderActionEmail({
    platformName: input.platformName,
    subject: text.subject,
    name: input.name,
    intro: text.intro,
    action: text.action,
    url: input.url,
    outro: "You can turn team emails off from the team's rules page.",
  });
}

export function disputeAlertEmail(input: {
  platformName: string;
  teamName: string;
  projectTitle: string;
  disputeId: string;
  reason: string;
  amount: string;
  url: string;
}): EmailContent {
  return renderActionEmail({
    platformName: input.platformName,
    subject: `PayPal dispute ${input.disputeId}`,
    name: input.teamName,
    intro: `PayPal opened dispute ${input.disputeId} on "${input.projectTitle}": ${input.reason.replace(/[\r\n]+/g, " ")}, ${input.amount}. Timers and payouts are paused until it resolves.`,
    action: "Open the dispute",
    url: input.url,
    outro: "Respond to PayPal within their window; the case page carries the details.",
  });
}
