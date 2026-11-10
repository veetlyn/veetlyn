// Team procedures as data: a skill is a named way of working that applies when its tool is offered at this node.
// The prepared quote flow (prepare.ts) is the same idea for work nobody typed. Skills never widen access: the
// tool list for the person's role and the team's agent switches decide what is offered first.
export const AGENT_SKILLS = [
  {
    id: "prepare-quote",
    label: "Prepare a quote",
    tool: "propose_quote_create",
    procedure: "Read the project first, price from the brief and the listed service range, and put the reason for the price in the card sentence.",
  },
  {
    id: "draft-client-message",
    label: "Draft a message to the client",
    tool: "propose_conversation_post",
    procedure: "Read the conversation first, draft in the team's voice, and keep it to what the client needs to decide or do next.",
  },
  {
    id: "prepare-payout-decision",
    label: "Prepare a payout decision",
    tool: "propose_payout_approve",
    procedure: "Read the payout and its balances first, say what is being decided and what happens after payday, and let the person confirm.",
  },
  {
    id: "assign-the-work",
    label: "Assign the work",
    tool: "propose_project_assign",
    procedure: "Only before quoting. Find the person with team_members, say who takes the work and why them, and propose it with their id.",
  },
] as const;

// The skill lines for this turn, for the skills whose tools survived role and team filtering.
export function skillLines(offeredToolNames: readonly string[]): string[] {
  return AGENT_SKILLS.filter((skill) => offeredToolNames.includes(skill.tool)).map(
    (skill) => `- Skill "${skill.label}": ${skill.procedure}`,
  );
}
