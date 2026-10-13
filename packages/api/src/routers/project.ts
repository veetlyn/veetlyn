import { MAX_QUOTE_ITEMS, QUOTE_REQUEST_LIMITS } from "@jendal-workspace/core";
import {
  findProjectById,
  listProjectAmendments,
  listProjectDeliveries,
  listProjectPayments,
  listProjectQuotes,
  listTeamProjects,
} from "@jendal-workspace/db/repositories/projects";
import { canSeeProject, type ServicesTeamRole, sellerPlanFor } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { listDeliveryFiles } from "@jendal-workspace/db/repositories/files";
import { getPayoutDestination } from "@jendal-workspace/db/repositories/payouts";
import { getTeamPayPalCountry } from "@jendal-workspace/db/repositories/paypal-onboarding";
import { hitRequestLimit } from "@jendal-workspace/db/repositories/request-limits";
import { getServicesTeamSettings, listServicesTeamMembers } from "@jendal-workspace/db/repositories/services-teams";
import { quoteRequestLinkEmail, quoteRequestNoticeEmail } from "@jendal-workspace/email";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { type LinkSecretSource, linkSecret, signClientLink, signPayLink, verifyClientLink } from "../client-links";
import { publicProcedure, router } from "../index";
import { servicesTeamProcedure } from "../services-team-procedure";
import { getClientRefundView, getStaffRefundView, refundClient } from "../use-cases/client-refunds";
import {
  acceptAmendment,
  acceptDelivery,
  acceptQuote,
  addQuote,
  assignFreelancer,
  declineAmendment,
  deliveryFileUrl,
  proposeAmendment,
  requestChanges,
  startDeliveryUpload,
  startProject,
  submitDelivery,
} from "../use-cases/projects";
import { requestQuote } from "../use-cases/requests";

const quoteItemInput = z.object({
  description: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().positive(),
  extraDays: z.number().int().min(0).max(365).default(0),
});

const projectIdInput = z.object({ projectId: z.string().uuid() });

const HOUR_MS = 3_600_000;

// Abuse caps only: the use-case validates and gives the friendly messages.
const requestQuoteInput = z.object({
  slug: z.string().min(1).max(63),
  offeringId: z.string().max(64).nullable(),
  name: z.string().max(QUOTE_REQUEST_LIMITS.maxName + 20),
  email: z.string().max(QUOTE_REQUEST_LIMITS.maxEmail),
  description: z.string().max(QUOTE_REQUEST_LIMITS.maxDescription + 100),
  answers: z
    .array(
      z.object({ question: z.string().max(200), answer: z.string().max(QUOTE_REQUEST_LIMITS.maxAnswer + 100) }),
    )
    .max(10),
  // Honeypot: bots fill the hidden "website" field; a filled field pretends success.
  website: z.string().max(200),
});

async function projectIdFromToken(auth: LinkSecretSource, token: string): Promise<string> {
  const projectId = await verifyClientLink(linkSecret(auth), token);
  if (!projectId) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
  return projectId;
}

type TeamViewer = {
  db: Database;
  servicesTeam: { id: string };
  servicesTeamRole: ServicesTeamRole;
  session: { user: { id: string } };
};

// A project the caller may not see is reported exactly like a missing one.
async function requireVisibleProject(ctx: TeamViewer, projectId: string) {
  const [settings, projects] = await Promise.all([
    getServicesTeamSettings(ctx.db, ctx.servicesTeam.id),
    listTeamProjects(ctx.db, ctx.servicesTeam.id),
  ]);
  const row = projects.find((p) => p.id === projectId);
  if (
    !row ||
    !canSeeProject({
      role: ctx.servicesTeamRole,
      actorId: ctx.session.user.id,
      assignedFreelancerId: row.assignedFreelancerId,
      status: row.status,
      quotingMode: settings?.quotingMode ?? "assigned",
    })
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  }
  return { row, settings };
}

// The storage key stays server-side; pages get the name and size, and a signed link on request.
async function withDeliveryFiles<T extends { id: string }>(
  db: Database,
  deliveries: T[],
): Promise<(T & { file: { name: string; sizeBytes: number } | null })[]> {
  const files = await listDeliveryFiles(db, deliveries.map((d) => d.id));
  const byDelivery = new Map(files.map((f) => [f.deliveryId, { name: f.fileName, sizeBytes: f.sizeBytes }]));
  return deliveries.map((d) => ({ ...d, file: byDelivery.get(d.id) ?? null }));
}

function teamActor(ctx: TeamViewer) {
  return { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id };
}

export const projectRouter = router({
  list: servicesTeamProcedure.query(async ({ ctx }) => {
    const settings = await getServicesTeamSettings(ctx.db, ctx.servicesTeam.id);
    const rows = await listTeamProjects(ctx.db, ctx.servicesTeam.id);
    return rows
      .filter((row) =>
        canSeeProject({
          role: ctx.servicesTeamRole,
          actorId: ctx.session.user.id,
          assignedFreelancerId: row.assignedFreelancerId,
          status: row.status,
          quotingMode: settings?.quotingMode ?? "assigned",
        }),
      )
      .map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        currency: row.currency,
        clientEmail: row.clientEmail,
        clientDiscordId: row.clientDiscordId,
        createdAt: row.createdAt,
      }));
  }),

  get: servicesTeamProcedure.input(projectIdInput).query(async ({ ctx, input }) => {
    const { row, settings } = await requireVisibleProject(ctx, input.projectId);
    // The quote calculator estimates the payout fee for the member who would be paid: the assigned one, or a
    // freelancer quoting for themselves. Only admins and the payee see the payee's PayPal country; others get the
    // international estimate.
    const payeeId = row.assignedFreelancerId ?? (ctx.servicesTeamRole === "freelancer" ? ctx.session.user.id : null);
    const seesPayee = ctx.servicesTeamRole === "admin" || payeeId === ctx.session.user.id;
    const [quotes, amendments, payments, deliveries, refund, senderCountry, payee] = await Promise.all([
      listProjectQuotes(ctx.db, row.id),
      listProjectAmendments(ctx.db, row.id),
      listProjectPayments(ctx.db, row.id),
      listProjectDeliveries(ctx.db, row.id),
      getStaffRefundView(ctx.db, row.id),
      getTeamPayPalCountry(ctx.db, ctx.servicesTeam.id),
      payeeId && seesPayee ? getPayoutDestination(ctx.db, payeeId) : null,
    ]);
    const clientToken = await signClientLink(linkSecret(ctx.auth), row.id);
    return {
      project: row,
      quotes,
      amendments,
      payments,
      deliveries: await withDeliveryFiles(ctx.db, deliveries),
      refund,
      clientPath: `/c/${clientToken}`,
      role: ctx.servicesTeamRole,
      quotingMode: settings?.quotingMode ?? "assigned",
      solo: settings?.solo ?? false,
      viewerId: ctx.session.user.id,
      quoteCalculator: {
        platformFeeBps: sellerPlanFor({ id: ctx.servicesTeam.id, solo: settings?.solo ?? false }).feeBps,
        senderCountry,
        receiverCountry: payee?.paypalCountry ?? null,
      },
    };
  }),

  members: servicesTeamProcedure.query(async ({ ctx }) => {
    const rows = await listServicesTeamMembers(ctx.db, ctx.servicesTeam);
    return rows.map((row) => ({ id: row.userId, name: row.name, email: row.email, role: row.role }));
  }),

  create: servicesTeamProcedure
    .input(
      z.object({
        title: z.string().max(200),
        brief: z.string().max(5000).default(""),
        clientEmail: z.string().max(200).default(""),
        clientDiscordId: z.string().max(64).default(""),
        channelId: z.string().max(64).default(""),
        offeringId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id };
      const { projectId } = await startProject(ctx.db, actor, input);
      const clientToken = await signClientLink(linkSecret(ctx.auth), projectId);
      return { projectId, clientPath: `/c/${clientToken}` };
    }),

  assign: servicesTeamProcedure
    .input(projectIdInput.extend({ freelancerId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assignFreelancer(ctx.db, { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id }, input);
    }),

  addQuote: servicesTeamProcedure
    .input(
      projectIdInput.extend({
        items: z.array(quoteItemInput).min(1).max(MAX_QUOTE_ITEMS),
        deliveryDays: z.number().int().min(1).max(365),
        freelancerId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return addQuote(ctx.db, { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id }, input);
    }),

  proposeAmendment: servicesTeamProcedure
    .input(
      projectIdInput.extend({
        add: z.array(quoteItemInput).max(MAX_QUOTE_ITEMS).default([]),
        removeItemIds: z.array(z.string().uuid()).max(MAX_QUOTE_ITEMS).default([]),
        note: z.string().max(2000).default(""),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return proposeAmendment(
        ctx.db,
        { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id },
        input,
      );
    }),

  deliveryUploadStart: servicesTeamProcedure
    .input(projectIdInput.extend({ fileName: z.string().min(1).max(1_000), sizeBytes: z.number().int().nonnegative() }))
    .mutation(async ({ ctx, input }) => {
      return startDeliveryUpload(ctx.db, ctx.files, teamActor(ctx), input);
    }),

  deliver: servicesTeamProcedure
    // Abuse caps only: the use-case trims and gives the friendly length messages.
    .input(
      projectIdInput.extend({
        note: z.string().max(10_000).default(""),
        link: z.string().max(10_000).default(""),
        fileUploadId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return submitDelivery(ctx.db, ctx.files, teamActor(ctx), input);
    }),

  refundClient: servicesTeamProcedure.input(projectIdInput).mutation(async ({ ctx, input }) => {
    return refundClient({ db: ctx.db, paypal: ctx.paypal }, teamActor(ctx), input);
  }),

  deliveryFileUrl: servicesTeamProcedure
    .input(projectIdInput.extend({ deliveryId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { row } = await requireVisibleProject(ctx, input.projectId);
      return deliveryFileUrl(ctx.db, ctx.files, { projectId: row.id, deliveryId: input.deliveryId });
    }),

  // The public quote request form (sellers design §4.2): no account, a honeypot, and per-IP and
  // per-email limits before a project row and the two emails. The honeypot check runs first so bots
  // never touch the limit budget; the per-email limit lives in the use-case, after validation.
  requestQuote: publicProcedure.input(requestQuoteInput).mutation(async ({ ctx, input }) => {
    if (input.website.trim() !== "") return { ok: true as const };
    const ip = ctx.headers.get("cf-connecting-ip")?.trim();
    if (ip) {
      const allowed = await hitRequestLimit(ctx.db, { key: `quote-request:ip:${ip}`, windowMs: HOUR_MS, max: 20 });
      if (!allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests. Wait a little and try again." });
      }
    }
    const emailServices = ctx.email;
    if (!emailServices) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Requests are not available right now." });
    }

    const { projectId, teamName, serviceName, supportEmail } = await requestQuote(ctx.db, input);
    const token = await signClientLink(linkSecret(ctx.auth), projectId);
    const clientUrl = `${emailServices.siteOrigin}/c/${token}`;
    const linkContent = quoteRequestLinkEmail({ clientName: input.name.trim(), teamName, url: clientUrl });
    // The client's mail proves the address, so its failure is the request's failure. The caller gets a
    // generic message; the provider's error text stays server-side.
    try {
      await emailServices.mailer.send({
        sender: "invoices",
        onBehalfOf: teamName,
        replyTo: supportEmail ?? undefined,
        tag: "quote-request",
        to: input.email.trim().toLowerCase(),
        ...linkContent,
      });
    } catch (error) {
      await emailServices.onError?.(error, { kind: "quote-request", to: input.email.trim().toLowerCase() });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "We could not send the email. Try again in a moment." });
    }
    if (supportEmail) {
      const notice = quoteRequestNoticeEmail({
        teamName,
        clientName: input.name.trim(),
        clientEmail: input.email.trim().toLowerCase(),
        serviceName,
        description: input.description.trim(),
        // Trimmed, as stored on the project.
        answers: input.answers.map(({ question, answer }) => ({ question: question.trim(), answer: answer.trim() })),
        url: `${emailServices.adminOrigin}/${input.slug}/projects/${projectId}`,
      });
      const send = emailServices.mailer
        .send({ sender: "invoices", onBehalfOf: teamName, tag: "quote-request-notice", to: supportEmail, ...notice })
        .catch((cause: unknown) => emailServices.onError?.(cause, { kind: "quote-request-notice", to: supportEmail }));
      if (emailServices.waitUntil) emailServices.waitUntil(send);
      else await send;
    }
    return { ok: true as const };
  }),

  // The client project page (services spec §5.2): signed link, no account. Internal user ids
  // (freelancerId, authorId, proposedById) and the PayPal ids stay server-side; the link holder
  // sees only what the page renders.
  clientGet: publicProcedure.input(z.object({ token: z.string().min(1) })).query(async ({ ctx, input }) => {
    const projectId = await projectIdFromToken(ctx.auth, input.token);
    const row = await findProjectById(ctx.db, projectId);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
    const [quotes, amendments, payments, deliveries, refund] = await Promise.all([
      listProjectQuotes(ctx.db, projectId),
      listProjectAmendments(ctx.db, projectId),
      listProjectPayments(ctx.db, projectId),
      listProjectDeliveries(ctx.db, projectId),
      getClientRefundView(ctx.db, projectId),
    ]);
    const secret = linkSecret(ctx.auth);
    const paymentViews = await Promise.all(
      payments.map(async (p) => ({
        id: p.id,
        kind: p.kind,
        status: p.status,
        amountMinor: p.amountMinor,
        refundedMinor: p.refundedMinor,
        lines: p.lines,
        createdAt: p.createdAt,
        // PayPal holds a capture it has not finished; the id itself stays server-side.
        processing: p.status === "pending" && p.paypalCaptureId !== null,
        // Pending and failed payments can be paid; the pay link names the payment, never the amount (§5.4).
        payPath: p.status === "pending" || p.status === "failed" ? `/pay/${await signPayLink(secret, p.id)}` : null,
      })),
    );
    return {
      project: {
        id: row.id,
        title: row.title,
        brief: row.brief,
        status: row.status,
        currency: row.currency,
        managementFeeBps: row.managementFeeBps,
        finalPriceMinor: row.finalPriceMinor,
      },
      quotes: quotes.map((q) => ({
        id: q.id,
        version: q.version,
        status: q.status,
        amountMinor: q.amountMinor,
        deliveryDays: q.deliveryDays,
        createdAt: q.createdAt,
        acceptedAt: q.acceptedAt,
        items: q.items.map((item) => ({
          id: item.id,
          description: item.description,
          amountMinor: item.amountMinor,
          extraDays: item.extraDays,
        })),
      })),
      amendments: amendments.map((a) => ({
        id: a.id,
        status: a.status,
        note: a.note,
        addItems: a.addItems,
        deltaMinor: a.deltaMinor,
        newAmountMinor: a.newAmountMinor,
        extraDays: a.extraDays,
        createdAt: a.createdAt,
      })),
      payments: paymentViews,
      deliveries: await withDeliveryFiles(
        ctx.db,
        deliveries.map((d) => ({
          id: d.id,
          status: d.status,
          note: d.note,
          link: d.link,
          clientNote: d.clientNote,
          createdAt: d.createdAt,
          decidedAt: d.decidedAt,
        })),
      ),
      refund,
    };
  }),

  clientAcceptQuote: publicProcedure
    .input(z.object({ token: z.string().min(1), quoteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      return acceptQuote(ctx.db, { projectId, quoteId: input.quoteId });
    }),

  clientAcceptAmendment: publicProcedure
    .input(z.object({ token: z.string().min(1), amendmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      return acceptAmendment(ctx.db, { projectId, amendmentId: input.amendmentId });
    }),

  clientDeclineAmendment: publicProcedure
    .input(z.object({ token: z.string().min(1), amendmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      await declineAmendment(ctx.db, { projectId, amendmentId: input.amendmentId });
    }),

  clientRequestChanges: publicProcedure
    .input(z.object({ token: z.string().min(1), deliveryId: z.string().uuid(), note: z.string().max(10_000) }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      await requestChanges(ctx.db, { projectId, deliveryId: input.deliveryId, note: input.note });
    }),

  clientDeliveryFileUrl: publicProcedure
    .input(z.object({ token: z.string().min(1), deliveryId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      return deliveryFileUrl(ctx.db, ctx.files, { projectId, deliveryId: input.deliveryId });
    }),

  clientAcceptDelivery: publicProcedure
    .input(z.object({ token: z.string().min(1), deliveryId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      return acceptDelivery(ctx.db, { projectId, deliveryId: input.deliveryId });
    }),
});
