import { defineMachine } from "../state-machines/machine";

export const RULEBOOK_STATUSES = ["draft", "published"] as const;
export type RulebookStatus = (typeof RULEBOOK_STATUSES)[number];

// One row per version of a team's rules. A team has at most one draft, edited in place until it is published; a
// published version never changes, so projects pinned to it keep their terms. The first version is created published.
export const rulebookMachine = defineMachine({
  name: "rulebook",
  states: RULEBOOK_STATUSES,
  initial: "draft",
  transitions: {
    edit: { from: ["draft"], to: "draft" },
    publish: { from: ["draft"], to: "published" },
  },
});
