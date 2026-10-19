"use client";

import { type BillingInterval, getSellerPlan } from "@jendal-workspace/core";
import { type ReactNode, useState } from "react";

import BundleBuilder from "@/components/site/bundle-builder";
import FeeCalculator from "@/components/site/fee-calculator";
import { Tier, type TierId } from "@/components/site/tiers";
import { PRICE_FACTS } from "@/lib/site/fees";

type Product = "services" | "store" | "both";

const TIER_IDS = {
  services: ["solo", "team", "agency", "enterprise"],
  store: ["starter", "grow", "scale", "enterprise"],
} as const satisfies Record<"services" | "store", readonly TierId[]>;

const drafts = (id: "solo" | "team" | "agency") => getSellerPlan(id).aiDraftsPerMonth.toLocaleString("en-US");

// A cell is "Yes" (true), a dash (false) or its own words.
type Row = { id: string; label: ReactNode; cells: readonly [boolean | string, boolean | string, boolean | string, boolean | string] };

const SERVICES_ROWS: readonly Row[] = [
  { id: "listed", label: "Listed on Payleor Network", cells: [true, true, true, true] },
  { id: "intake", label: "Intake agent, drafts a month", cells: [drafts("solo"), drafts("team"), drafts("agency"), "Custom"] },
  { id: "copilot", label: "Team copilot", cells: [false, true, true, true] },
  { id: "payout", label: "Payout agent", cells: [false, false, true, true] },
  { id: "api", label: "Your own agents, through the API", cells: [false, true, true, true] },
  {
    id: "seo",
    label: (
      <>
        Web SEO on every page <span className="soon">Coming with run V</span>
      </>
    ),
    cells: [true, true, true, true],
  },
  { id: "discord", label: "Discord request threads", cells: [false, true, true, true] },
];
const STORE_ROWS: readonly Row[] = [
  { id: "carts", label: "Sold in Payleor Network carts", cells: [true, true, true, true] },
  { id: "checkout", label: "One checkout across stores", cells: [true, true, true, true] },
  { id: "admin", label: "Admin agent", cells: [false, true, true, true] },
  { id: "credits", label: "AI credits for your agents", cells: ["Some", "More", "The most", "Custom"] },
];

function Switch<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="switch" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function AgentsTable({ head, rows, hidden }: { head: readonly string[]; rows: readonly Row[]; hidden: boolean }) {
  const [first, ...columns] = head;
  return (
    <div className="table-wrap" hidden={hidden}>
      <table>
        <thead>
          <tr>
            <th scope="col">{first}</th>
            {columns.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.label}</th>
              {row.cells.map((v, i) => (
                <td key={columns[i]} className={v === false ? "n" : "y"}>
                  {v === true ? "Yes" : v === false ? "—" : v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The pricing page's plans, agent tables and calculator, which all follow the product and billing switches.
export default function PricingExplorer({ signupUrl }: { signupUrl: string }) {
  const [product, setProduct] = useState<Product>("services");
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  return (
    <>
      <section aria-labelledby="plans-h" style={{ paddingTop: "clamp(48px,6vw,80px)" }}>
        <div className="wrap">
          <h2 id="plans-h" className="sr-only">
            Plans
          </h2>
          <div className="model" style={{ marginTop: "0" }} data-in>
            <div>
              <b>A plan</b>
              <span>From {PRICE_FACTS.from} a month</span>
            </div>
            <div>
              <b>
                {PRICE_FACTS.minFee.replace("%", "")}–{PRICE_FACTS.maxFee}
              </b>
              <span>On each payment or order</span>
            </div>
            <div className="hit">
              <b>{PRICE_FACTS.network} once</b>
              <span>Only on clients AI brings you</span>
            </div>
          </div>
          <div className="controls">
            <Switch
              label="Pricing for"
              value={product}
              onChange={setProduct}
              options={[
                ["services", "Services"],
                ["store", "Store"],
                ["both", "Services + store"],
              ]}
            />
            <Switch
              label="Billing"
              value={interval}
              onChange={setInterval}
              options={[
                ["monthly", "Monthly"],
                ["yearly", "Yearly, 2 months free"],
              ]}
            />
          </div>
          {product !== "both" && (
            <div className="tiers">
              {TIER_IDS[product].map((id) => (
                <Tier key={id} id={id} interval={interval} signupUrl={signupUrl} />
              ))}
            </div>
          )}
          {product === "both" && (
            <div className="calc-wrap" style={{ marginTop: "24px" }}>
              <div>
                <h3 style={{ fontSize: "clamp(26px,2.6vw,36px)", lineHeight: "1.1" }}>Run services and a store</h3>
                <p className="lead-dark">
                  Pick one plan of each. The dearer one is full price, the other is half, and every payment and order
                  pays the lower fee.
                </p>
              </div>
              <BundleBuilder interval={interval} />
            </div>
          )}
        </div>
      </section>
      <section aria-labelledby="agents-h">
        <div className="wrap">
          <h2 id="agents-h" data-in>
            Agents in every plan
          </h2>
          <p className="lead-dark" data-in>
            Their AI finds and shops. Your agents draft, answer and pay by your rules. The payer approves every payment
            in PayPal, and a person or your rule approves every payout.
          </p>
          <AgentsTable
            head={["Services", "Solo", "Team", "Agency", "Enterprise"]}
            rows={SERVICES_ROWS}
            hidden={product === "store"}
          />
          <AgentsTable
            head={["Store", "Starter", "Grow", "Scale", "Enterprise"]}
            rows={STORE_ROWS}
            hidden={product === "services"}
          />
        </div>
      </section>
      {product !== "both" && (
        <section aria-labelledby="calc-h">
          <div className="wrap calc-wrap">
            <div>
              <h2 id="calc-h" data-in>
                What you would pay on a sale
              </h2>
              <p className="lead-dark" data-in>
                Pick a plan and a price. PayPal's own fee is separate, and Payleor never adds to it.
              </p>
            </div>
            <FeeCalculator product={product} interval={interval} />
          </div>
        </section>
      )}
    </>
  );
}
