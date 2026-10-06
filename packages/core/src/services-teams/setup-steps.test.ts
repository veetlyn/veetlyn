import { describe, expect, it } from "vitest";

import { countDone } from "../onboarding/setup-steps";
import { servicesTeamSetupSteps } from "./setup-steps";

describe("servicesTeamSetupSteps", () => {
  it("starts a new team with only the first step done; steps without a link have no href", () => {
    const steps = servicesTeamSetupSteps(
      { paypalMerchantId: null, settingsSaved: false, discordGuildId: null },
      { settings: "/acme-studio/settings" },
    );

    expect(steps).toEqual([
      { id: "create-team", label: "Create your team", done: true },
      { id: "set-rates", label: "Set your rates", done: false, href: "/acme-studio/settings" },
      { id: "connect-paypal", label: "Connect PayPal", done: false },
      { id: "add-payout-credentials", label: "Add payout credentials", done: false },
      { id: "link-discord", label: "Link Discord", done: false },
    ]);
    expect(countDone(steps)).toBe(1);
  });

  it("links the steps whose target exists, and marks rates, PayPal and Discord done", () => {
    const steps = servicesTeamSetupSteps(
      { paypalMerchantId: "MERCHANT1", settingsSaved: true, discordGuildId: "guild-1" },
      {
        settings: "/acme-studio/settings",
        connectPaypal: "https://www.paypal.com",
        linkDiscord: "/acme-studio/discord",
      },
    );

    expect(steps.map((s) => s.done)).toEqual([true, true, true, false, true]);
    expect(steps.find((s) => s.id === "link-discord")?.href).toBe("/acme-studio/discord");
  });
});
