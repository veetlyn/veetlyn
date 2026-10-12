import { describe, expect, it } from "vitest";

import { payoutActions } from "./payouts";

describe("payoutActions", () => {
  it.each([
    ["requested", false, ["approve", "reject"]],
    ["queued", false, ["retry"]],
    ["sending", false, []],
    ["sending", true, ["retry"]],
    ["sent", false, ["refresh"]],
    ["succeeded", false, []],
    ["failed", false, []],
    ["rejected", false, []],
  ] as const)("%s (uncertain: %s)", (status, uncertain, actions) => {
    expect(payoutActions({ status, uncertain })).toEqual(actions);
  });
});
