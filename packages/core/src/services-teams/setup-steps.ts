import type { SetupStep } from "../onboarding/setup-steps";

// Later plans add the missing links: S3 Connect PayPal, the payouts plan credentials, S2 Discord.
// A step without a link renders as plain text (the checklist shows it as not yet available).
export type ServicesTeamSetupLinks = {
  settings: string;
  connectPaypal?: string;
  payoutCredentials?: string;
  linkDiscord?: string;
};

function step(id: string, label: string, done: boolean, href?: string): SetupStep {
  return href ? { id, label, done, href } : { id, label, done };
}

export function servicesTeamSetupSteps(
  state: { paypalMerchantId: string | null; settingsSaved: boolean },
  links: ServicesTeamSetupLinks,
): SetupStep[] {
  return [
    step("create-team", "Create your team", true),
    step("set-rates", "Set your rates", state.settingsSaved, links.settings),
    step("connect-paypal", "Connect PayPal", state.paypalMerchantId !== null, links.connectPaypal),
    step("add-payout-credentials", "Add payout credentials", false, links.payoutCredentials),
    step("link-discord", "Link Discord", false, links.linkDiscord),
  ];
}
