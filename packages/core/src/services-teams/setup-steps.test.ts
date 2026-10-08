import { describe, expect, it } from "vitest";

import { countDone } from "../onboarding/setup-steps";
import { servicesTeamSetupSteps } from "./setup-steps";

describe("servicesTeamSetupSteps", () => {
  it("starts a new team with only the first step done; steps without a link have no href", () => {
    const steps = servicesTeamSetupSteps(
      { paypalMerchantId: null, settingsSaved: false, discordGuildId: null, solo: false, offeringCount: 0 },
      { settings: "/acme-studio/settings", services: "/acme-studio/services" },
    );

    expect(steps).toEqual([
      { id: "create-team", label: "Create your team", done: true },
      { id: "add-service", label: "Add your first service", done: false, href: "/acme-studio/services" },
      { id: "connect-paypal", label: "Connect PayPal", done: false },
      { id: "set-rates", label: "Set your rates", done: false, href: "/acme-studio/settings" },
      { id: "add-payout-credentials", label: "Add payout credentials", done: false },
      { id: "link-discord", label: "Link Discord", done: false },
    ]);
    expect(countDone(steps)).toBe(1);
  });

  it("marks the service, rates and PayPal steps done once the team has them", () => {
    const steps = servicesTeamSetupSteps(
      { paypalMerchantId: "MERCHANT1", settingsSaved: true, discordGuildId: null, solo: false, offeringCount: 2 },
      {
        settings: "/acme-studio/settings",
        services: "/acme-studio/services",
        connectPaypal: "https://www.paypal.com",
        linkDiscord: "/acme-studio/discord",
      },
    );

    expect(steps.map((s) => s.done)).toEqual([true, true, true, true, false, false]);
    expect(steps.find((s) => s.id === "add-service")?.href).toBe("/acme-studio/services");
    expect(steps.find((s) => s.id === "link-discord")?.href).toBe("/acme-studio/discord");
  });

  it("gives a solo seller no rates or payout steps, and relabels the first step", () => {
    const steps = servicesTeamSetupSteps(
      { paypalMerchantId: "MERCHANT1", settingsSaved: true, discordGuildId: null, solo: true, offeringCount: 1 },
      { settings: "/acme-solo/settings", services: "/acme-solo/services", linkDiscord: "/acme-solo/discord" },
    );

    expect(steps).toEqual([
      { id: "create-team", label: "Create your seller page", done: true },
      { id: "add-service", label: "Add your first service", done: true, href: "/acme-solo/services" },
      { id: "connect-paypal", label: "Connect PayPal", done: true },
      { id: "link-discord", label: "Link Discord", done: false, href: "/acme-solo/discord" },
    ]);
  });
});
