// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { type BillingNoticeData, BillingNoticeView } from "./billing-notice";

const base: BillingNoticeData = {
  state: "trial",
  subscribed: false,
  trialEndsAt: "2026-11-14T00:00:00.000Z",
  graceEndsAt: null,
  product: "services",
  organizationId: "org-1",
  canManage: true,
};

function render(notice: BillingNoticeData) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(BillingNoticeView, { notice }));
  return root;
}

describe("billing notice", () => {
  it("is a polite status, never an interrupting alert, in every state", () => {
    for (const state of ["trial", "grace", "lapsed"] as const) {
      const root = render({ ...base, state, graceEndsAt: "2026-11-20T00:00:00.000Z" });
      expect(root.querySelector('[role="status"]')).not.toBeNull();
      expect(root.querySelector('[role="alert"]')).toBeNull();
    }
  });

  it("sends people who can change the plan to Billing, and tells everyone else who can", () => {
    const owner = render(base);
    expect(owner.querySelector("a")?.getAttribute("href")).toBe("/w/org-1/billing");
    expect(owner.textContent).toContain("Choose a plan");

    const member = render({ ...base, state: "lapsed", canManage: false });
    expect(member.querySelector("a")).toBeNull();
    expect(member.textContent).toContain("Selling is paused");
    expect(member.textContent).toContain("A workspace owner or admin can fix this.");
  });
});
