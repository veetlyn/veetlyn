import { defineMachine } from "../state-machines/machine";

export const AGENT_PROPOSAL_STATUSES = ["pending", "done", "declined", "failed"] as const;
export type AgentProposalStatus = (typeof AGENT_PROPOSAL_STATUSES)[number];

// A card the assistant puts to a person. Confirming claims it as done before the action runs, so a second click finds
// nothing to claim; an action that then throws records the card as failed.
export const agentProposalMachine = defineMachine({
  name: "agent_proposal",
  states: AGENT_PROPOSAL_STATUSES,
  initial: "pending",
  transitions: {
    confirm: { from: ["pending"], to: "done" },
    decline: { from: ["pending"], to: "declined" },
    fail: { from: ["done"], to: "failed" },
  },
});
