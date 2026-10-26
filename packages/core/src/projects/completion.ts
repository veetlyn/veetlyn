import { completionTransfer, refundRequestedTransfer } from "../ledger/postings";
import type { LedgerTransferDraft } from "../ledger/transfers";
import type { MoneyCurrency } from "../money/money";
import type { Balance } from "./pricing";

// One refund per completed project; the ledger reference and the refund.requested event share it.
export function completionRefundId(projectId: string): string {
  return `completion-${projectId}`;
}

export type CompletionPostings = { transfers: LedgerTransferDraft[]; refundMinor: number };

// Services spec §6.3: on completion the final price leaves client_held as the team cut and the freelancer's
// earnings; money the client paid above the final price (amendment decreases) is owed back to them.
export function completionPostings(input: {
  currency: MoneyCurrency;
  projectId: string;
  freelancerId: string;
  finalPriceMinor: number;
  teamCutBps: number;
  managerId?: string | null;
  managerCutBps?: number;
  memberBearsMinor?: number;
  balance: Balance;
}): CompletionPostings {
  const { currency, projectId, balance } = input;
  const transfers: LedgerTransferDraft[] = [];
  if (input.finalPriceMinor > 0) {
    transfers.push(
      completionTransfer({
        currency,
        projectId,
        freelancerId: input.freelancerId,
        finalPriceMinor: input.finalPriceMinor,
        teamCutBps: input.teamCutBps,
        managerId: input.managerId,
        managerCutBps: input.managerCutBps,
        memberBearsMinor: input.memberBearsMinor,
      }),
    );
  }
  if (balance.refundMinor > 0) {
    transfers.push(
      refundRequestedTransfer({
        currency,
        projectId,
        refundId: completionRefundId(projectId),
        quotePartMinor: balance.refundQuoteMinor,
        managementFeeMinor: balance.refundManagementFeeMinor,
      }),
    );
  }
  return { transfers, refundMinor: balance.refundMinor };
}
