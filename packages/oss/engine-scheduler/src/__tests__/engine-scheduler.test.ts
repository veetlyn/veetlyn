import { describe, expect, it } from "vitest";

import { AGENCY_RULEBOOK_SPEC, SOLO_RULEBOOK_SPEC } from "@opmodel/engine-rules";

import { planProjectSchedule } from "../index";

const T = (iso: string) => new Date(iso);
const H = 3600_000;

describe("planProjectSchedule", () => {
  it("schedules the response reminder and expiry while a request awaits a reply", () => {
    const requestedAt = T("2026-10-01T00:00:00Z");
    const plan = planProjectSchedule({
      projectStatus: "quoting",
      requestedAt,
      workStartedAt: null,
      lastMemberActivityAt: null,
      deliveredAt: null,
      pausedByDispute: false,
      rules: AGENCY_RULEBOOK_SPEC.rules,
    });
    expect(plan.paused).toBe(false);
    expect(plan.schedule).toEqual([
      { kind: "request.remind", runAt: new Date(requestedAt.getTime() + 36 * H) },
      { kind: "request.expire", runAt: new Date(requestedAt.getTime() + 48 * H) },
    ]);
    expect(plan.cancel).toEqual([]);
  });

  it("cancels the response window once the seller replied", () => {
    const plan = planProjectSchedule({
      projectStatus: "quoting",
      requestedAt: T("2026-10-01T00:00:00Z"),
      workStartedAt: null,
      lastMemberActivityAt: T("2026-10-01T05:00:00Z"),
      deliveredAt: null,
      pausedByDispute: false,
      rules: AGENCY_RULEBOOK_SPEC.rules,
    });
    expect(plan.schedule).toEqual([]);
    expect(plan.cancel).toEqual(["request.remind", "request.expire"]);
  });

  it("schedules member update checks from the latest member activity", () => {
    const workStartedAt = T("2026-10-01T00:00:00Z");
    const lastActivity = T("2026-10-02T00:00:00Z");
    const plan = planProjectSchedule({
      projectStatus: "in_progress",
      requestedAt: T("2026-09-30T00:00:00Z"),
      workStartedAt,
      lastMemberActivityAt: lastActivity,
      deliveredAt: null,
      pausedByDispute: false,
      rules: AGENCY_RULEBOOK_SPEC.rules,
    });
    expect(plan.schedule).toEqual([
      { kind: "member.updateRemind", runAt: new Date(lastActivity.getTime() + 40 * H) },
      { kind: "member.updateLate", runAt: new Date(lastActivity.getTime() + 48 * H) },
    ]);
    expect(plan.cancel).toEqual(["request.remind", "request.expire"]);
  });

  it("schedules the client review ladder and auto-complete after delivery", () => {
    const deliveredAt = T("2026-10-01T00:00:00Z");
    const plan = planProjectSchedule({
      projectStatus: "delivered",
      requestedAt: null,
      workStartedAt: T("2026-09-01T00:00:00Z"),
      lastMemberActivityAt: T("2026-09-28T00:00:00Z"),
      deliveredAt,
      pausedByDispute: false,
      rules: AGENCY_RULEBOOK_SPEC.rules,
    });
    expect(plan.schedule).toEqual([
      { kind: "client.reviewRemind1", runAt: new Date(deliveredAt.getTime() + 5 * 24 * H) },
      { kind: "client.reviewRemind2", runAt: new Date(deliveredAt.getTime() + 10 * 24 * H) },
      { kind: "project.autoComplete", runAt: new Date(deliveredAt.getTime() + 14 * 24 * H) },
    ]);
    expect(plan.cancel).toEqual(["member.updateRemind", "member.updateLate"]);
  });

  it("ends an abandon ladder with project.abandon instead of auto-complete", () => {
    const plan = planProjectSchedule({
      projectStatus: "delivered",
      requestedAt: null,
      workStartedAt: T("2026-09-01T00:00:00Z"),
      lastMemberActivityAt: null,
      deliveredAt: T("2026-10-01T00:00:00Z"),
      pausedByDispute: false,
      rules: { ...AGENCY_RULEBOOK_SPEC.rules, clientSilence: { ...AGENCY_RULEBOOK_SPEC.rules.clientSilence, silenceOutcome: "abandon" } },
    });
    expect(plan.schedule.map((item) => item.kind)).toEqual(["client.reviewRemind1", "client.reviewRemind2", "project.abandon"]);
  });

  it("schedules nothing in terminal states and cancels everything pending", () => {
    for (const projectStatus of ["completed", "cancelled", "declined", "expired", "abandoned"] as const) {
      const plan = planProjectSchedule({
        projectStatus,
        requestedAt: T("2026-10-01T00:00:00Z"),
        workStartedAt: T("2026-10-02T00:00:00Z"),
        lastMemberActivityAt: T("2026-10-03T00:00:00Z"),
        deliveredAt: T("2026-10-04T00:00:00Z"),
        pausedByDispute: false,
        rules: AGENCY_RULEBOOK_SPEC.rules,
      });
      expect(plan.schedule, projectStatus).toEqual([]);
      expect(plan.cancel, projectStatus).toEqual([
        "request.remind",
        "request.expire",
        "member.updateRemind",
        "member.updateLate",
        "client.reviewRemind1",
        "client.reviewRemind2",
        "project.autoComplete",
        "project.abandon",
      ]);
    }
  });

  it("holds due items while a dispute pauses the project", () => {
    const plan = planProjectSchedule({
      projectStatus: "in_progress",
      requestedAt: null,
      workStartedAt: T("2026-10-01T00:00:00Z"),
      lastMemberActivityAt: null,
      deliveredAt: null,
      pausedByDispute: true,
      rules: SOLO_RULEBOOK_SPEC.rules,
    });
    expect(plan.paused).toBe(true);
    expect(plan.schedule).toEqual([]);
    expect(plan.cancel).toEqual([]);
  });
});
