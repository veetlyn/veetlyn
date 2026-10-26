import { listServicesTeamMembers } from "@jendal-workspace/db/repositories/services-teams";

import {
  projectClientAdd,
  projectClientLinkEmail,
  projectClientLinkReissue,
  projectClientPreview,
  projectClientRemove,
} from "../actions/clients";
import {
  conversationAnswer,
  conversationPost,
  requestDecline,
  requestListOpen,
  requestShortlist,
} from "../actions/conversations";
import {
  deliveryAccept,
  deliveryFile,
  deliveryRequestChanges,
  deliverySubmit,
  deliveryUploadStart,
} from "../actions/deliveries";
import {
  projectAssign,
  projectClientList,
  projectClientView,
  projectGet,
  projectList,
  projectLateRefundDecide,
  projectQualityRefundSet,
  projectRefundClient,
  projectStart,
  projectWarningRecord,
} from "../actions/projects";
import { amendmentAccept, amendmentDecline, amendmentPropose, quoteAccept, quoteCreate } from "../actions/quotes";
import { createRequest, requestTerms } from "../actions/requests";
import { clientProcedureFor, optionalSessionProcedureFor, publicProcedureFor, signedInProcedureFor, teamProcedureFor } from "../actions/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { linkSecret } from "../client-links";
import { publicProcedure, router } from "../index";
import { teamSlugForLink } from "../use-cases/link-hosts";
import { servicesTeamProcedure } from "../services-team-procedure";

export const projectRouter = router({
  list: teamProcedureFor(projectList),
  get: teamProcedureFor(projectGet),

  members: servicesTeamProcedure.query(async ({ ctx }) => {
    const rows = await listServicesTeamMembers(ctx.db, ctx.servicesTeam);
    return rows.map((row) => ({ id: row.userId, name: row.name, email: row.email, role: row.role }));
  }),

  create: teamProcedureFor(projectStart),
  assign: teamProcedureFor(projectAssign),
  addQuote: teamProcedureFor(quoteCreate),
  proposeAmendment: teamProcedureFor(amendmentPropose),
  deliveryUploadStart: teamProcedureFor(deliveryUploadStart),
  deliver: teamProcedureFor(deliverySubmit),
  refundClient: teamProcedureFor(projectRefundClient),
  decideLateRefund: teamProcedureFor(projectLateRefundDecide),
  setQualityRefund: teamProcedureFor(projectQualityRefundSet),
  recordWarning: teamProcedureFor(projectWarningRecord),
  deliveryFileUrl: teamProcedureFor(deliveryFile),
  clientAdd: teamProcedureFor(projectClientAdd),
  clientRemove: teamProcedureFor(projectClientRemove),
  clientLinkEmail: teamProcedureFor(projectClientLinkEmail),
  clientLinkReissue: teamProcedureFor(projectClientLinkReissue),
  clientPreview: teamProcedureFor(projectClientPreview),
  openRequests: teamProcedureFor(requestListOpen),
  post: teamProcedureFor(conversationPost),
  decline: teamProcedureFor(requestDecline),
  shortlist: teamProcedureFor(requestShortlist),

  requestQuote: optionalSessionProcedureFor(createRequest),
  requestTerms: publicProcedureFor(requestTerms),
  mine: signedInProcedureFor(projectClientList),

  // The web Worker asks which team's site serves a link before rendering the client or pay page on a host.
  linkTeam: publicProcedure
    .input(z.object({ kind: z.enum(["client", "pay"]), token: z.string().min(1).max(512) }))
    .query(async ({ ctx, input }) => {
      const slug = await teamSlugForLink(ctx.db, linkSecret(ctx.auth), input);
      if (!slug) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
      return { slug };
    }),

  clientGet: clientProcedureFor(projectClientView),
  clientAcceptQuote: clientProcedureFor(quoteAccept),
  clientAcceptAmendment: clientProcedureFor(amendmentAccept),
  clientDeclineAmendment: clientProcedureFor(amendmentDecline),
  clientRequestChanges: clientProcedureFor(deliveryRequestChanges),
  clientDeliveryFileUrl: clientProcedureFor(deliveryFile),
  clientAcceptDelivery: clientProcedureFor(deliveryAccept),
  clientPost: clientProcedureFor(conversationPost),
  clientAnswer: clientProcedureFor(conversationAnswer),
});
