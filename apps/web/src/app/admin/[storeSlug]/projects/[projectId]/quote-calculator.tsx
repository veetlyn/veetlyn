"use client";

import {
  formatMoney,
  money,
  type MoneyCurrency,
  parseMajorAmount,
  type QuoteBreakdown,
  quoteForMemberTarget,
} from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useState } from "react";

export type QuoteCalculatorRates = {
  currency: MoneyCurrency;
  teamCutBps: number;
  managementFeeBps: number;
  platformFeeBps: number;
  senderCountry: string | null;
  receiverCountry: string | null;
};

const TARGET_PROBLEM = "Enter what the member should receive.";

type Calculation = { kind: "empty" } | { kind: "problem"; message: string } | { kind: "quote"; breakdown: QuoteBreakdown };

function calculate(rates: QuoteCalculatorRates, target: string): Calculation {
  if (target.trim() === "") return { kind: "empty" };
  const targetNetMinor = parseMajorAmount(target);
  if (targetNetMinor === null) return { kind: "problem", message: TARGET_PROBLEM };
  try {
    return { kind: "quote", breakdown: quoteForMemberTarget({ ...rates, targetNetMinor }) };
  } catch (error) {
    return { kind: "problem", message: error instanceof Error ? error.message : TARGET_PROBLEM };
  }
}

function QuoteResult({
  breakdown,
  format,
  onUseQuote,
}: {
  breakdown: QuoteBreakdown;
  format: (minor: number) => string;
  onUseQuote: ((quoteMinor: number) => void) | null;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <p className="font-medium">Quote {format(breakdown.quoteMinor)}</p>
        {onUseQuote ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onUseQuote(breakdown.quoteMinor)}>
            Use this quote
          </Button>
        ) : null}
      </div>
      <ul className="space-y-1 text-muted-foreground">
        <li>Client pays {format(breakdown.clientPaysMinor)}</li>
        <li>PayPal's checkout fee (about) {format(breakdown.checkoutFeeMinor)}, paid by the team</li>
        <li>Payleor's fee {format(breakdown.platformFeeMinor)}</li>
        <li>Team keeps {format(breakdown.teamKeepsMinor)}</li>
        <li>PayPal's payout fee (about) {format(breakdown.payoutFeeMinor)}</li>
        <li>Member receives {format(breakdown.memberReceivesMinor)}</li>
      </ul>
    </>
  );
}

// Sits inside the New quote form: Enter in its input must not send the quote.
export function QuoteCalculator({
  rates,
  onUseQuote,
}: {
  rates: QuoteCalculatorRates;
  onUseQuote: ((quoteMinor: number) => void) | null;
}) {
  const [target, setTarget] = useState("");
  const calculation = calculate(rates, target);
  const format = (minor: number) => formatMoney(money(rates.currency, minor));

  return (
    <fieldset className="space-y-3 border-t pt-3">
      <legend className="text-sm font-medium">Quote calculator</legend>
      <div className="space-y-2">
        <Label htmlFor="member-target">The member should receive ({rates.currency})</Label>
        <Input
          id="member-target"
          inputMode="decimal"
          placeholder="0.00"
          className="w-40"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          aria-describedby="member-target-result"
        />
      </div>
      <div id="member-target-result" className="space-y-2 text-sm">
        {calculation.kind === "problem" ? <p className="text-destructive">{calculation.message}</p> : null}
        {calculation.kind === "quote" ? (
          <QuoteResult breakdown={calculation.breakdown} format={format} onUseQuote={onUseQuote} />
        ) : null}
      </div>
    </fieldset>
  );
}
