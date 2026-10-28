import type { RulebookRules } from "@opmodel/engine-rules";

export type ScheduleItemKind =
  | "request.remind"
  | "request.expire"
  | "member.updateRemind"
  | "member.updateLate"
  | "client.reviewRemind1"
  | "client.reviewRemind2"
  | "project.autoComplete"
  | "project.abandon";

export const SCHEDULE_ITEM_KINDS: readonly ScheduleItemKind[] = [
  "request.remind",
  "request.expire",
  "member.updateRemind",
  "member.updateLate",
  "client.reviewRemind1",
  "client.reviewRemind2",
  "project.autoComplete",
  "project.abandon",
];

const RESPONSE_KINDS: ScheduleItemKind[] = ["request.remind", "request.expire"];
const UPDATE_KINDS: ScheduleItemKind[] = ["member.updateRemind", "member.updateLate"];

// The review ladder ends in the outcome the rulebook pins.
function reviewKinds(rules: RulebookRules): ScheduleItemKind[] {
  return ["client.reviewRemind1", "client.reviewRemind2", rules.clientSilence.silenceOutcome === "abandon" ? "project.abandon" : "project.autoComplete"];
}

export type ProjectStatusForScheduling =
  | "quoting"
  | "awaiting_deposit"
  | "in_progress"
  | "delivered"
  | "awaiting_balance"
  | "completed"
  | "cancelled"
  | "declined"
  | "expired"
  | "abandoned";

const TERMINAL_STATUSES: ReadonlySet<ProjectStatusForScheduling> = new Set(["completed", "cancelled", "declined", "expired", "abandoned"]);

export type PlannedItem = { kind: ScheduleItemKind; runAt: Date };

// What the store should upsert and cancel for a subject right now. `cancel` names the kinds the previous
// phase had armed, so reconciliation only ever touches items that exist.
export type SchedulePlan = { paused: boolean; schedule: PlannedItem[]; cancel: ScheduleItemKind[] };

export type ProjectScheduleInput = {
  projectStatus: ProjectStatusForScheduling;
  requestedAt: Date | null;
  workStartedAt: Date | null;
  // The seller's latest activity: in quoting a quote, question or decline; while working, the last update.
  lastMemberActivityAt: Date | null;
  deliveredAt: Date | null;
  pausedByDispute: boolean;
  rules: RulebookRules;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function at(base: Date, ms: number): PlannedItem["runAt"] {
  return new Date(base.getTime() + ms);
}

export function planProjectSchedule(input: ProjectScheduleInput): SchedulePlan {
  if (input.pausedByDispute) return { paused: true, schedule: [], cancel: [] };
  if (TERMINAL_STATUSES.has(input.projectStatus)) return { paused: false, schedule: [], cancel: [...SCHEDULE_ITEM_KINDS] };

  if (input.projectStatus === "quoting") {
    const replied =
      input.lastMemberActivityAt !== null && input.requestedAt !== null && input.lastMemberActivityAt.getTime() > input.requestedAt.getTime();
    if (replied || input.requestedAt === null) return { paused: false, schedule: [], cancel: RESPONSE_KINDS };
    const { hours, remindBeforeHours } = input.rules.responseWindow;
    return {
      paused: false,
      schedule: [
        { kind: "request.remind", runAt: at(input.requestedAt, Math.max(hours - remindBeforeHours, 0) * HOUR_MS) },
        { kind: "request.expire", runAt: at(input.requestedAt, hours * HOUR_MS) },
      ],
      cancel: [],
    };
  }

  if (input.projectStatus === "awaiting_deposit") {
    return { paused: false, schedule: [], cancel: RESPONSE_KINDS };
  }

  if (input.projectStatus === "in_progress") {
    const anchors = [input.workStartedAt, input.lastMemberActivityAt].filter((value): value is Date => value !== null);
    if (anchors.length === 0) return { paused: false, schedule: [], cancel: RESPONSE_KINDS };
    const anchor = new Date(Math.max(...anchors.map((value) => value.getTime())));
    const { hours, remindBeforeHours } = input.rules.updateWindow;
    return {
      paused: false,
      schedule: [
        { kind: "member.updateRemind", runAt: at(anchor, Math.max(hours - remindBeforeHours, 0) * HOUR_MS) },
        { kind: "member.updateLate", runAt: at(anchor, hours * HOUR_MS) },
      ],
      cancel: RESPONSE_KINDS,
    };
  }

  if (input.projectStatus === "delivered") {
    if (input.deliveredAt === null) return { paused: false, schedule: [], cancel: UPDATE_KINDS };
    const { firstReminderDays, secondReminderDays, finalDays } = input.rules.clientSilence;
    return {
      paused: false,
      schedule: [
        { kind: "client.reviewRemind1", runAt: at(input.deliveredAt, firstReminderDays * DAY_MS) },
        { kind: "client.reviewRemind2", runAt: at(input.deliveredAt, secondReminderDays * DAY_MS) },
        { kind: input.rules.clientSilence.silenceOutcome === "abandon" ? "project.abandon" : "project.autoComplete", runAt: at(input.deliveredAt, finalDays * DAY_MS) },
      ],
      cancel: UPDATE_KINDS,
    };
  }

  // awaiting_balance: the client accepted the delivery, so the review ladder is done.
  return { paused: false, schedule: [], cancel: reviewKinds(input.rules) };
}
