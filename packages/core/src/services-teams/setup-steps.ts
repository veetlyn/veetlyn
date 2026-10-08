import type { SetupStep } from "../onboarding/setup-steps";

// Later plans add the missing links: S3 Connect PayPal, the payouts plan credentials.
// A step without a link renders as plain text (the checklist shows it as not yet available).
export type ServicesTeamSetupLinks = {
  settings: string;
  services: string;
  connectPaypal?: string;
  payoutCredentials?: string;
  linkDiscord?: string;
};

function step(id: string, label: string, done: boolean, href?: string): SetupStep {
  return href ? { id, label, done, href } : { id, label, done };
}

export function servicesTeamSetupSteps(
  state: {
    paypalMerchantId: string | null;
    settingsSaved: boolean;
    discordGuildId: string | null;
    solo: boolean;
    offeringCount: number;
  },
  links: ServicesTeamSetupLinks,
): SetupStep[] {
  return [
    step("create-team", state.solo ? "Create your seller page" : "Create your team", true),
    // Sellers design §3.2: the seller page needs at least one service or one product.
    step("add-service", "Add your first service", state.offeringCount > 0, links.services),
    step("connect-paypal", "Connect PayPal", state.paypalMerchantId !== null, links.connectPaypal),
    // A solo seller keeps the whole price, so there are no rates and no payouts to set up (run 5).
    ...(state.solo ? [] : [step("set-rates", "Set your rates", state.settingsSaved, links.settings)]),
    ...(state.solo ? [] : [step("add-payout-credentials", "Add payout credentials", false, links.payoutCredentials)]),
    step("link-discord", "Link Discord", state.discordGuildId !== null, links.linkDiscord),
  ];
}
