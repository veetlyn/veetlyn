import { defineRelationsPart } from "drizzle-orm";

import { account, session, user, verification } from "./auth";
import { invitation, member, organization, team, teamMember } from "./organization";

export const authRelations = defineRelationsPart(
  { user, session, account, verification, organization, member, invitation, team, teamMember },
  (r) => ({
    user: {
      sessions: r.many.session({ from: r.user.id, to: r.session.userId }),
      accounts: r.many.account({ from: r.user.id, to: r.account.userId }),
      members: r.many.member({ from: r.user.id, to: r.member.userId }),
      invitations: r.many.invitation({ from: r.user.id, to: r.invitation.inviterId }),
      teamMembers: r.many.teamMember({ from: r.user.id, to: r.teamMember.userId }),
    },
    session: {
      user: r.one.user({ from: r.session.userId, to: r.user.id }),
    },
    account: {
      user: r.one.user({ from: r.account.userId, to: r.user.id }),
    },
    organization: {
      members: r.many.member({ from: r.organization.id, to: r.member.organizationId }),
      invitations: r.many.invitation({ from: r.organization.id, to: r.invitation.organizationId }),
      teams: r.many.team({ from: r.organization.id, to: r.team.organizationId }),
    },
    member: {
      organization: r.one.organization({ from: r.member.organizationId, to: r.organization.id }),
      user: r.one.user({ from: r.member.userId, to: r.user.id }),
    },
    invitation: {
      organization: r.one.organization({ from: r.invitation.organizationId, to: r.organization.id }),
      user: r.one.user({ from: r.invitation.inviterId, to: r.user.id }),
    },
    team: {
      organization: r.one.organization({ from: r.team.organizationId, to: r.organization.id }),
      teamMembers: r.many.teamMember({ from: r.team.id, to: r.teamMember.teamId }),
    },
    teamMember: {
      team: r.one.team({ from: r.teamMember.teamId, to: r.team.id }),
      user: r.one.user({ from: r.teamMember.userId, to: r.user.id }),
    },
  }),
);
