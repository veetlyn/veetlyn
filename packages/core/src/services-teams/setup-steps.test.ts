import { describe, expect, it } from "vitest";

import { countDone } from "../onboarding/setup-steps";
import { servicesTeamSetupSteps } from "./setup-steps";

describe("servicesTeamSetupSteps", () => {
  it("starts a new team with only the first step done; steps without a link have no href", () => {
    const steps = servicesTeamSetupSteps(
      {
        status: "draft",
        paypalMerchantId: null,
        settingsSaved: false,
        discordGuildId: null,
        solo: false,
        offeringCount: 0,
        productCount: 0,
        payoutCredentialsSaved: false,
      },
      { settings: "/acme-studio/settings", services: "/acme-studio/services" },
    );

    expect(steps).toEqual([
      { id: "create-team", label: "Create your team", done: true },
      { id: "add-service", label: "Add a service or a product", done: false, href: "/acme-studio/services" },
      { id: "connect-paypal", label: "Connect PayPal", done: false },
      { id: "set-rates", label: "Set your rates", done: false, href: "/acme-studio/settings" },
      { id: "add-payout-credentials", label: "Add payout credentials", done: false },
      { id: "publish", label: "Publish your seller page", done: false },
      { id: "link-discord", label: "Link Discord", done: false },
    ]);
    expect(countDone(steps)).toBe(1);
  });

  it("marks the service, rates, PayPal, payout credentials and publish steps done once the team has them", () => {
    const steps = servicesTeamSetupSteps(
      {
        status: "active",
        paypalMerchantId: "MERCHANT1",
        settingsSaved: true,
        discordGuildId: null,
        solo: false,
        offeringCount: 2,
        productCount: 0,
        payoutCredentialsSaved: true,
      },
      {
        settings: "/acme-studio/settings",
        services: "/acme-studio/services",
        connectPaypal: "https://www.paypal.com",
        publish: "#publish",
        linkDiscord: "/acme-studio/discord",
      },
    );

    expect(steps.map((s) => s.done)).toEqual([true, true, true, true, true, true, false]);
    expect(steps.find((s) => s.id === "add-service")?.href).toBe("/acme-studio/services");
    expect(steps.find((s) => s.id === "publish")).toEqual({
      id: "publish",
      label: "Publish your seller page",
      done: true,
      href: "#publish",
    });
    expect(steps.find((s) => s.id === "link-discord")?.href).toBe("/acme-studio/discord");
  });

  it("gives a solo seller no rates or payout steps, and relabels the first step", () => {
    const steps = servicesTeamSetupSteps(
      {
        status: "draft",
        paypalMerchantId: "MERCHANT1",
        settingsSaved: true,
        discordGuildId: null,
        solo: true,
        offeringCount: 1,
        productCount: 0,
        payoutCredentialsSaved: false,
      },
      {
        settings: "/acme-solo/settings",
        services: "/acme-solo/services",
        publish: "#publish",
        linkDiscord: "/acme-solo/discord",
      },
    );

    expect(steps).toEqual([
      { id: "create-team", label: "Create your seller page", done: true },
      { id: "add-service", label: "Add a service or a product", done: true, href: "/acme-solo/services" },
      { id: "connect-paypal", label: "Connect PayPal", done: true },
      { id: "publish", label: "Publish your seller page", done: false, href: "#publish" },
      { id: "link-discord", label: "Link Discord", done: false, href: "/acme-solo/discord" },
    ]);
  });
});
