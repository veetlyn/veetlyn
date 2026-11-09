const SCHEDULE_LABELS = new Map<string, string>([
  ["request.remind", "Reminder to answer this request"],
  ["request.expire", "This request expires"],
  ["member.updateRemind", "Reminder to post an update"],
  ["member.updateLate", "Late-update mark"],
  ["client.reviewRemind1", "Reminder to the client to review"],
  ["client.reviewRemind2", "Second reminder to the client"],
  ["project.autoComplete", "Project completes on its own"],
  ["project.abandon", "Project closes as abandoned"],
]);

export function scheduleLabel(kind: string): string {
  return SCHEDULE_LABELS.get(kind) ?? "Scheduled step";
}

export function scheduleWhen(item: { runAt: Date | string; status: string }): string {
  if (item.status === "paused") return "Paused during the dispute";
  return new Date(item.runAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
