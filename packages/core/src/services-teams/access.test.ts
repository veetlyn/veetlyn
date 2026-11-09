import { describe, expect, it } from "vitest";

import { accessRefuses, canReadMoney, effectiveMemberAccess, FULL_ACCESS, type MemberAccess } from "./access";

const limits = (over: Partial<MemberAccess>): MemberAccess => ({ ...FULL_ACCESS, ...over });

describe("member access", () => {
  it("never limits an admin", () => {
    expect(effectiveMemberAccess("admin", limits({ hidden: ["projects"] }))).toBe(FULL_ACCESS);
    expect(effectiveMemberAccess("manager", limits({ hidden: ["projects"] })).hidden).toEqual(["projects"]);
  });

  it("follows the project's stage: a request while quoting, a project after", () => {
    const access = limits({ hidden: ["projects"] });
    expect(accessRefuses("project.get", access, "quoting")).toBe(false);
    expect(accessRefuses("project.get", access, "in_progress")).toBe(true);
    expect(accessRefuses("project.start", access, null)).toBe(true);
    expect(accessRefuses("request.list_open", access, null)).toBe(false);
  });

  it("stops anything that sets a price when finances are hidden, and leaves the rest of the project", () => {
    const access = limits({ hideProjectFinances: true });
    expect(accessRefuses("quote.create", access, "quoting")).toBe(true);
    expect(accessRefuses("project.refund_client", access, "completed")).toBe(true);
    expect(accessRefuses("delivery.submit", access, "in_progress")).toBe(false);
  });

  it("refuses an action nobody classified, but only to someone with limits", () => {
    expect(accessRefuses("project.new_thing", limits({ hidden: ["storefront"] }), null)).toBe(true);
    expect(accessRefuses("project.new_thing", FULL_ACCESS, null)).toBe(false);
  });

  it("lets a money viewer read Money, which approving still does not follow from", () => {
    expect(canReadMoney("freelancer", FULL_ACCESS)).toBe(false);
    expect(canReadMoney("freelancer", limits({ moneyViewer: true }))).toBe(true);
    expect(canReadMoney("admin", FULL_ACCESS)).toBe(true);
    expect(canReadMoney(null, limits({ moneyViewer: true }))).toBe(false);
  });
});
