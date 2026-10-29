import {
  type BillingInterval,
  formatOrderFee,
  formatPlanPrice,
  getPlan,
  getSellerPlan,
  type PlanId,
  type SellerPlanId,
} from "@jendal-workspace/core";
import Link from "next/link";
import type { ReactNode } from "react";

import { PlatformName } from "@/components/platform-name";
import { usd } from "@/lib/site/examples";

export type TierId = SellerPlanId | PlanId | "enterprise";

type TierCard = {
  name: string;
  for: string;
  priceCents: Record<BillingInterval, number> | null;
  fee: ReactNode;
  cta: string;
  kind?: "pick" | "is-dark";
  btn: "btn-quiet" | "btn-ink" | "btn-mint";
  href?: string;
  // The "Everything in …, plus:" line that opens the list on the bigger plans.
  plusLine?: string;
  // Shown but not yet offered.
  soon?: boolean;
  features: readonly ReactNode[];
};
type TierTable = Readonly<Record<TierId, TierCard>>;

const COMING_SOON = <span className="later">Coming soon</span>;

function services(id: SellerPlanId): Pick<TierCard, "name" | "priceCents" | "fee" | "cta"> {
  const p = getSellerPlan(id);
  return {
    name: p.name,
    priceCents: p.priceCents,
    fee: (
      <>
        <strong>{formatOrderFee(p.feeBps)}</strong> on each client payment
      </>
    ),
    cta: `Start with ${p.name}`,
  };
}

function store(id: PlanId): Pick<TierCard, "name" | "priceCents" | "fee" | "cta"> {
  const p = getPlan(id);
  return {
    name: p.name,
    priceCents: p.priceCents,
    fee: (
      <>
        <strong>{formatOrderFee(p.orderFeeBps)}</strong> on each order
      </>
    ),
    cta: `Start with ${p.name}`,
  };
}

const solo = getSellerPlan("solo");
const team = getSellerPlan("team");
const agency = getSellerPlan("agency");

const TIERS = {
  solo: {
    ...services("solo"),
    for: "For one freelancer",
    btn: "btn-quiet",
    features: [
      <b key="n">
        Listed on <PlatformName /> Network
      </b>,
      <>
        <b>Agent-written quotes</b>, {solo.aiDraftsPerMonth} drafts a month
      </>,
      "Your seller page and pay links",
      "Pay pages, deposits and deliveries",
      "Guest checkout with PayPal",
      <>
        <b>Web SEO</b> built into every page {COMING_SOON}
      </>,
      `${solo.storageGb} GB of files`,
      <>Export everything {COMING_SOON}</>,
    ],
  },
  team: {
    ...services("team"),
    for: "For small agencies and remote teams",
    kind: "pick",
    btn: "btn-ink",
    plusLine: "Everything in Solo, plus:",
    features: [
      `Up to ${team.members} members`,
      <>
        <b>Agent-written quotes</b>, {team.aiDraftsPerMonth.toLocaleString("en-US")} drafts a month
      </>,
      <>
        <b>Business answers</b> from your agent
      </>,
      "Manage or schedule team payouts",
      <>Team chat and the public API {COMING_SOON}</>,
      <>
        Your own domain, no <PlatformName /> badge {COMING_SOON}
      </>,
      `${team.storageGb} GB of files`,
    ],
  },
  agency: {
    ...services("agency"),
    for: `For agencies up to ${agency.members} people`,
    btn: "btn-quiet",
    plusLine: "Everything in Team, plus:",
    features: [
      `Up to ${agency.members} members`,
      <>
        <b>Agent-written quotes</b>, {agency.aiDraftsPerMonth.toLocaleString("en-US")} drafts a month
      </>,
      <>
        <b>Agent-assisted payouts</b> and exception handling
      </>,
      "A second approver for big payouts",
      "Several services teams",
      "Priority support",
      `${agency.storageGb} GB of files`,
    ],
  },
  enterprise: {
    name: "Enterprise",
    for: "For networks and large teams",
    priceCents: null,
    fee: (
      <>
        <strong>Custom</strong> fees
      </>
    ),
    cta: "Talk to sales",
    soon: true,
    kind: "is-dark",
    btn: "btn-mint",
    href: "/contact#sales",
    plusLine: "Everything in Agency or Scale, plus:",
    features: [
      `More than ${agency.members} people`,
      "Several agencies, shops and studios in one account",
      "Custom agent limits",
      "A named contact and onboarding help",
      "Help moving your catalog",
      <span key="l" className="later">
        Self-hosted, planned for 2027
      </span>,
    ],
  },
  starter: {
    ...store("starter"),
    for: "For creators and new shops",
    btn: "btn-quiet",
    features: [
      <b key="c">
        Listed in <PlatformName /> Network {COMING_SOON}
      </b>,
      "Storefront on your page",
      <>
        <b>Web SEO</b> built into every page {COMING_SOON}
      </>,
      "Digital downloads and courses",
      "Shipped goods, flat shipping and tracking",
      "PayPal checkout on your page",
      "AI credits for your agent",
      `${getPlan("starter").staffSeats} staff accounts`,
    ],
  },
  grow: {
    ...store("grow"),
    for: "For growing shops",
    kind: "pick",
    btn: "btn-ink",
    plusLine: "Everything in Starter, plus:",
    features: [
      <span key="a"><b>Store management with your agent</b> {COMING_SOON}</span>,
      "More AI credits",
      <>Your own domain {COMING_SOON}</>,
      `${getPlan("grow").staffSeats} staff accounts`,
    ],
  },
  scale: {
    ...store("scale"),
    for: "For large catalogs",
    btn: "btn-quiet",
    plusLine: "Everything in Grow, plus:",
    features: ["The most AI credits", `${getPlan("scale").staffSeats} staff accounts`, "Priority support"],
  },
} satisfies TierTable;

export function Tier({ id, interval, signupUrl }: { id: TierId; interval: BillingInterval; signupUrl: string }) {
  const t: TierCard = TIERS[id];
  const href = t.href ?? signupUrl;
  return (
    <article className={`tier ${t.kind ?? ""} ${id === "enterprise" ? "wide" : ""}`} data-in>
      <div>
        <p className="name">{t.name}{t.soon ? <> {COMING_SOON}</> : null}</p>
        <p className="for">{t.for}</p>
      </div>
      <div>
        {t.priceCents ? (
          <>
            <p className="price num">
              <span>{formatPlanPrice(t.priceCents[interval])}</span>
              <small> a month</small>
            </p>
            <p className="bill">
              {interval === "yearly"
                ? `Billed ${usd(t.priceCents.yearly * 12)} a year`
                : "Billed monthly"}
            </p>
          </>
        ) : (
          <>
            <p className="price">Custom</p>
            <p className="bill">Fees and limits set with you</p>
          </>
        )}
      </div>
      <p className="fee">{t.fee}</p>
      {href.startsWith("/") ? (
        <Link className={`btn ${t.btn}`} href={href}>
          {href === "/waitlist" ? "Join the waitlist" : t.cta}
        </Link>
      ) : (
        <a className={`btn ${t.btn}`} href={href}>
          {href === "/waitlist" ? "Join the waitlist" : t.cta}
        </a>
      )}
      <ul>
        {t.plusLine && <li className="plus">{t.plusLine}</li>}
        {t.features.map((f, i) => (
          // The features are a fixed list, so their position is their identity.
          // oxlint-disable-next-line react/no-array-index-key
          <li key={i}>{f}</li>
        ))}
      </ul>
    </article>
  );
}

export default function Tiers({
  ids,
  interval = "monthly",
  signupUrl,
  className = "tiers",
}: {
  ids: readonly TierId[];
  interval?: BillingInterval;
  signupUrl: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {ids.map((id) => (
        <Tier key={id} id={id} interval={interval} signupUrl={signupUrl} />
      ))}
    </div>
  );
}
