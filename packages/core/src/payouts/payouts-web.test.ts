import { describe, expect, it } from "vitest";

import { parsePayoutsWebLog, payoutReference, payoutsWebCsv, type PayoutsWebRow } from "./payouts-web";

// The CSV log PayPal's sandbox gave for a one-payout Payouts Web upload (Activity > the payout > Download), byte for
// byte: a BOM, a preamble, then the table. Money cells use the account's locale and a no-break space before the code.
const SANDBOX_LOG = `\uFEFFTransaction Type: Mass Payment
Date and time of submission: 13 October 2026 at 09:00:58 GMT
Date and time of processing: 13 October 2026 at 09:01:38 GMT
Date and time of completed: 13 October 2026 at 09:01:38 GMT

Subject: 
Note: 

"Payment Amount: $1,00\u00A0USD in 1 payment"
"Fee Amount: $0,02\u00A0USD"
"Total Amount: $1,02\u00A0USD"

"Completed Amount: $1,00\u00A0USD in 1 payment"
"Unclaimed Amount: $0,00\u00A0USD in 0 payments"
"Returned Amount: $0,00\u00A0USD in 0 payments"
"Denied Amount: $0,00\u00A0USD in 0 payments"
"Pending Amount: $0,00\u00A0USD in 0 payments"
"Blocked Amount: $0,00\u00A0USD in 0 payments"

Transaction ID,Recipient,Recipient Name,Unique Identifier,Amount,Fee,Total,Status,Reason Code,Custom Note,Message
0N1309609K054603L,AWVNN2ZZ6ZWT4,,PLTEST000001,"$1,00\u00A0USD","$0,02\u00A0USD","$1,02\u00A0USD",Completed,,Payleor test,`;

const PAYOUTS_WEB_HEADER =
  "Transaction ID,Recipient,Recipient Name,Unique Identifier,Amount,Fee,Total,Status,Reason Code,Custom Note,Message";

function payoutsWebLog(row: { amount?: string; fee?: string; status?: string; reasonCode?: string; message?: string }) {
  const cells = [
    "TX1",
    "AWVNN2ZZ6ZWT4",
    "",
    "PLREF0000001",
    row.amount ?? `"$1,00 USD"`,
    row.fee ?? `"$0,02 USD"`,
    "",
    row.status ?? "Completed",
    row.reasonCode ?? "",
    "",
    row.message ?? "",
  ];
  return `${PAYOUTS_WEB_HEADER}\r\n${cells.join(",")}\r\n`;
}

describe("parsePayoutsWebLog", () => {
  it("reads PayPal's Payouts Web log after its preamble", () => {
    expect(parsePayoutsWebLog(SANDBOX_LOG)).toEqual([
      {
        reference: "PLTEST000001",
        transactionId: "0N1309609K054603L",
        paypalStatus: "Completed",
        status: "succeeded",
        reason: null,
        currency: "USD",
        amountMinor: 100,
        feeMinor: 2,
      },
    ]);
  });

  it.each([
    { amount: `"$1,00 USD"`, amountMinor: 100, currency: "USD" },
    { amount: `"$1,234.56 USD"`, amountMinor: 123_456, currency: "USD" },
    { amount: `"1.234,56 €"`, amountMinor: 123_456, currency: null },
    { amount: `"1 234,56 EUR"`, amountMinor: 123_456, currency: "EUR" },
    { amount: "1.00", amountMinor: 100, currency: null },
    { amount: "-24.50", amountMinor: 2_450, currency: null },
    { amount: `"1,000"`, amountMinor: 100_000, currency: null },
    { amount: "", amountMinor: null, currency: null },
  ])("reads the amount $amount", ({ amount, amountMinor, currency }) => {
    expect(parsePayoutsWebLog(payoutsWebLog({ amount, fee: "" }))).toEqual([
      expect.objectContaining({ amountMinor, currency, feeMinor: null }),
    ]);
  });

  it("refuses an amount it cannot read rather than guessing", () => {
    expect(() => parsePayoutsWebLog(payoutsWebLog({ amount: "n/a" }))).toThrow(
      `PayPal's log has an amount Payleor cannot read: "n/a".`,
    );
  });

  it.each([
    { status: "Completed", outcome: "succeeded" },
    { status: "SUCCESS", outcome: "succeeded" },
    { status: "Returned", outcome: "failed" },
    { status: "Denied", outcome: "failed" },
    { status: "BLOCKED", outcome: "failed" },
    { status: "Failed", outcome: "failed" },
    { status: "Refunded", outcome: "failed" },
    { status: "reversed", outcome: "failed" },
    { status: "Unclaimed", outcome: "pending" },
    { status: "Pending", outcome: "pending" },
    { status: "Processing", outcome: "pending" },
    { status: "UNCLAIMED", outcome: "pending" },
  ])("reads $status as $outcome", ({ status, outcome }) => {
    expect(parsePayoutsWebLog(payoutsWebLog({ status }))).toEqual([expect.objectContaining({ status: outcome })]);
  });

  it("takes PayPal's message as the failure reason, else its reason code", () => {
    const withMessage = payoutsWebLog({ status: "Denied", reasonCode: "RISK_DECLINE", message: "Receiver is unregistered" });
    expect(parsePayoutsWebLog(withMessage)).toEqual([expect.objectContaining({ reason: "Receiver is unregistered" })]);
    expect(parsePayoutsWebLog(payoutsWebLog({ status: "Denied", reasonCode: "RISK_DECLINE" }))).toEqual([
      expect.objectContaining({ reason: "RISK_DECLINE" }),
    ]);
  });

  it("reads the large-batch report layout, its currency column, and skips rows without a reference", () => {
    const log = [
      "REF_ID,PAYOUT_ITEM_ID,TRANSACTION_ID,RECIPIENT_NAME,RECIPIENT,CURRENCY_CODE,PAYOUT_AMOUNT,FEE,TOTAL,TRANSACTION_STATUS,ERROR_ENUM,ERROR_MESSAGE,TIME_PROCESSED",
      "PLREF0000001,ITEM1,TX1,Ada,AWVNN2ZZ6ZWT4,EUR,24.50,0.49,24.99,FAILED,RECEIVER_UNREGISTERED,,2026-10-13",
      ",ITEM2,TX2,Bo,PAYER2,EUR,10.00,0.25,10.25,SUCCESS,,,2026-10-13",
      "",
    ].join("\n");
    expect(parsePayoutsWebLog(log)).toEqual([
      {
        reference: "PLREF0000001",
        transactionId: "TX1",
        paypalStatus: "FAILED",
        status: "failed",
        reason: "RECEIVER_UNREGISTERED",
        currency: "EUR",
        amountMinor: 2_450,
        feeMinor: 49,
      },
    ]);
  });

  it.each([
    { case: "a table without a Customer ID column", log: "Transaction ID,Amount,Status\nTX1,1.00,Completed\n" },
    { case: "a file without PayPal's table", log: "Name,Amount\nAda,1.00\n" },
  ])("refuses $case", ({ log }) => {
    expect(() => parsePayoutsWebLog(log)).toThrow(
      "This file has no Customer ID column. Download the payout's CSV log from PayPal.",
    );
  });
});

describe("payoutsWebCsv", () => {
  const row: PayoutsWebRow = {
    receiverPayerId: "AWVNN2ZZ6ZWT4",
    sentMinor: 2_450,
    currency: "USD",
    reference: "PL7K2M9Q4XR1AB",
    note: "Payout from Walk Crew via Payleor",
  };

  it("writes PayPal's upload rows without a header, quoting a note with a comma", () => {
    expect(payoutsWebCsv([row, { ...row, receiverPayerId: "PAYER2", sentMinor: 100_000, note: `Crew, "Walk"` }])).toBe(
      [
        "AWVNN2ZZ6ZWT4,24.50,USD,PL7K2M9Q4XR1AB,Payout from Walk Crew via Payleor,PAYPAL",
        'PAYER2,1000.00,USD,PL7K2M9Q4XR1AB,"Crew, ""Walk""",PAYPAL',
      ].join("\r\n"),
    );
  });

  // The note carries the team's name, and admins open this file in a spreadsheet before uploading it.
  it("keeps a note that starts like a formula from running in a spreadsheet", () => {
    expect(payoutsWebCsv([{ ...row, note: '=HYPERLINK("http://x")' }, { ...row, note: "+1-2" }])).toBe(
      [
        `AWVNN2ZZ6ZWT4,24.50,USD,PL7K2M9Q4XR1AB,"'=HYPERLINK(""http://x"")",PAYPAL`,
        "AWVNN2ZZ6ZWT4,24.50,USD,PL7K2M9Q4XR1AB,'+1-2,PAYPAL",
      ].join("\r\n"),
    );
  });

  it.each([
    { case: "no rows", rows: [], message: "Choose at least one payout to export." },
    {
      case: "more than 5000 rows",
      rows: Array.from({ length: 5_001 }, () => row),
      message: "Export at most 5000 payouts at a time.",
    },
    {
      case: "two currencies",
      rows: [row, { ...row, currency: "EUR" as const }],
      message: "Export one currency at a time.",
    },
  ])("refuses $case", ({ rows, message }) => {
    expect(() => payoutsWebCsv(rows)).toThrow(message);
  });
});

describe("payoutReference", () => {
  it("makes distinct PayPal-safe Customer IDs", () => {
    const references = Array.from({ length: 1_000 }, () => payoutReference());
    for (const reference of references) expect(reference).toMatch(/^PL[A-Z2-9]{12}$/);
    expect(new Set(references).size).toBe(1_000);
  });
});
