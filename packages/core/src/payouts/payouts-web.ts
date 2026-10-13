import { type MoneyCurrency, toPayPalValue } from "../money/money";
import type { PayoutOutcome } from "./requests";

// PayPal Payouts Web: an admin uploads a CSV of payouts in PayPal, then downloads the payout's CSV log and imports it.

// The upload's row limit (developer.paypal.com/payouts/use-payouts/send-money/use-web-ui).
export const PAYOUTS_WEB_MAX_ROWS = 5_000;

export class PayoutsWebError extends Error {
  override name = "PayoutsWebError";
}

export type PayoutsWebRow = {
  receiverPayerId: string;
  sentMinor: number;
  currency: MoneyCurrency;
  // The Customer ID PayPal echoes in its log; it matches the log back to the payout.
  reference: string;
  note: string;
};

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

// Upload rows, no header: receiver, amount, currency, Customer ID, note, recipient type.
export function payoutsWebCsv(rows: readonly PayoutsWebRow[]): string {
  if (rows.length === 0) throw new PayoutsWebError("Choose at least one payout to export.");
  if (rows.length > PAYOUTS_WEB_MAX_ROWS) {
    throw new PayoutsWebError(`Export at most ${PAYOUTS_WEB_MAX_ROWS} payouts at a time.`);
  }
  if (new Set(rows.map((row) => row.currency)).size > 1) throw new PayoutsWebError("Export one currency at a time.");
  return rows
    .map((row) =>
      [row.receiverPayerId, toPayPalValue(row.sentMinor), row.currency, row.reference, row.note, "PAYPAL"]
        .map(csvCell)
        .join(","),
    )
    .join("\r\n");
}

const REFERENCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789";
// Bytes at or above the largest multiple of the alphabet size are redrawn, so every character is equally likely.
const REFERENCE_BYTE_LIMIT = 256 - (256 % REFERENCE_ALPHABET.length);

// "PL" and 12 random characters: PayPal limits the Customer ID to 30 characters without spaces.
export function payoutReference(): string {
  let reference = "PL";
  while (reference.length < 14) {
    const [byte = REFERENCE_BYTE_LIMIT] = crypto.getRandomValues(new Uint8Array(1));
    if (byte < REFERENCE_BYTE_LIMIT) reference += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  }
  return reference;
}

export type PayoutsWebResult = {
  reference: string;
  transactionId: string | null;
  // PayPal's status word as written in the log.
  paypalStatus: string;
  status: PayoutOutcome;
  reason: string | null;
  // The ISO code in the money cells or the currency column; null when the log names none.
  currency: string | null;
  amountMinor: number | null;
  feeMinor: number | null;
};

// Payouts Web log names first, then the large-batch report and Activity Download names.
const COLUMNS = {
  reference: ["unique identifier", "customer id", "reference id", "ref_id"],
  transactionId: ["transaction id", "transaction_id"],
  amount: ["amount", "payout_amount", "gross"],
  fee: ["fee"],
  status: ["status", "transaction_status"],
  currency: ["currency_code"],
  reason: ["message", "error_message", "reason code", "error_enum"],
} as const;

const HEADER_FIRST_CELLS = new Set(["transaction id", "ref_id", "transaction_id"]);
const NO_REFERENCE_COLUMN = "This file has no Customer ID column. Download the payout's CSV log from PayPal.";

const SUCCEEDED_STATUSES = new Set(["completed", "success"]);
const FAILED_STATUSES = new Set(["returned", "denied", "blocked", "failed", "refunded", "reversed"]);

// RFC 4180: quoted cells may hold commas, doubled quotes and line breaks.
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) rows.push([...row, cell]);
  return rows;
}

const normalized = (cell: string | undefined) => (cell ?? "").trim().toLowerCase();

function columnIndex(header: readonly string[], names: readonly string[]): number | null {
  for (const name of names) {
    const index = header.findIndex((cell) => normalized(cell) === name);
    if (index >= 0) return index;
  }
  return null;
}

type LogMoney = { minor: number; currency: string | null };

// Money is written in the PayPal account's locale ("$1,00 USD", "$1,234.56 USD", "1.234,56 €"): a `,` or `.` before
// exactly two final digits is the decimal separator, and every other separator groups thousands.
function logMoney(cell: string): LogMoney | null {
  const text = cell.trim();
  if (text === "") return null;
  const currency = /\b([A-Z]{3})\b/.exec(text)?.[1] ?? null;
  const number = text.replace(/\b[A-Z]{3}\b/, "").replace(/[^\d,.]/g, "");
  const match = /^([\d,.]*?)(?:[,.](\d{2}))?$/.exec(number);
  const whole = match?.[1]?.replace(/[,.]/g, "") ?? "";
  if (!match || (whole === "" && match[2] === undefined)) {
    throw new PayoutsWebError(`PayPal's log has an amount Payleor cannot read: "${text}".`);
  }
  const minor = Number(whole || "0") * 100 + Number(match[2] ?? "0");
  if (!Number.isSafeInteger(minor)) throw new PayoutsWebError(`PayPal's log has an amount Payleor cannot read: "${text}".`);
  return { minor, currency };
}

function outcomeOf(status: string): PayoutOutcome {
  const word = status.trim().toLowerCase();
  if (SUCCEEDED_STATUSES.has(word)) return "succeeded";
  if (FAILED_STATUSES.has(word)) return "failed";
  return "pending";
}

// Everything before PayPal's table (the Payouts Web log's summary preamble) is ignored, and so are rows without a
// Customer ID.
export function parsePayoutsWebLog(text: string): PayoutsWebResult[] {
  const rows = csvRows(text.replace(/^\uFEFF/, ""));
  const headerAt = rows.findIndex((row) => HEADER_FIRST_CELLS.has(normalized(row[0])));
  const header = rows[headerAt] ?? [];
  const reference = columnIndex(header, COLUMNS.reference);
  if (headerAt < 0 || reference === null) throw new PayoutsWebError(NO_REFERENCE_COLUMN);
  const at = {
    transactionId: columnIndex(header, COLUMNS.transactionId),
    amount: columnIndex(header, COLUMNS.amount),
    fee: columnIndex(header, COLUMNS.fee),
    status: columnIndex(header, COLUMNS.status),
    currency: columnIndex(header, COLUMNS.currency),
  };
  const reasonAt = COLUMNS.reason.map((name) => columnIndex(header, [name]));
  const cell = (row: readonly string[], index: number | null) => (index === null ? "" : (row[index] ?? "").trim());

  const results: PayoutsWebResult[] = [];
  for (const row of rows.slice(headerAt + 1)) {
    const ref = cell(row, reference);
    if (ref === "") continue;
    const amount = logMoney(cell(row, at.amount));
    const fee = logMoney(cell(row, at.fee));
    const paypalStatus = cell(row, at.status);
    results.push({
      reference: ref,
      transactionId: cell(row, at.transactionId) || null,
      paypalStatus,
      status: outcomeOf(paypalStatus),
      reason: reasonAt.map((index) => cell(row, index)).find((value) => value !== "") ?? null,
      currency: amount?.currency ?? fee?.currency ?? (cell(row, at.currency) || null),
      amountMinor: amount?.minor ?? null,
      feeMinor: fee?.minor ?? null,
    });
  }
  return results;
}
