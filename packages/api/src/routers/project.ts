import { listServicesTeamMembers } from "@jendal-workspace/db/repositories/services-teams";

import {
  projectClientAdd,
  projectClientLinkEmail,
  projectClientLinkReissue,
  projectClientPreview,
  projectClientRemove,
} from "../actions/clients";
import {
  deliveryAccept,
  deliveryFile,
  deliveryRequestChanges,
  deliverySubmit,
  deliveryUploadStart,
} from "../actions/deliveries";
import {
  projectAssign,
  projectClientView,
  projectGet,
  projectList,
  projectRefundClient,
  projectStart,
} from "../actions/projects";
import { amendmentAccept, amendmentDecline, amendmentPropose, quoteAccept, quoteCreate } from "../actions/quotes";
import { createRequest } from "../actions/requests";
import { clientProcedureFor, publicProcedureFor, teamProcedureFor } from "../actions/trpc";
import { router } from "../index";
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
  deliveryFileUrl: teamProcedureFor(deliveryFile),
  clientAdd: teamProcedureFor(projectClientAdd),
  clientRemove: teamProcedureFor(projectClientRemove),
  clientLinkEmail: teamProcedureFor(projectClientLinkEmail),
  clientLinkReissue: teamProcedureFor(projectClientLinkReissue),
  clientPreview: teamProcedureFor(projectClientPreview),

  requestQuote: publicProcedureFor(createRequest),

  clientGet: clientProcedureFor(projectClientView),
  clientAcceptQuote: clientProcedureFor(quoteAccept),
  clientAcceptAmendment: clientProcedureFor(amendmentAccept),
  clientDeclineAmendment: clientProcedureFor(amendmentDecline),
  clientRequestChanges: clientProcedureFor(deliveryRequestChanges),
  clientDeliveryFileUrl: clientProcedureFor(deliveryFile),
  clientAcceptDelivery: clientProcedureFor(deliveryAccept),
});
