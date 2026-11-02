import { disputeList, paymentList } from "../actions/money";
import { teamProcedureFor } from "../actions/trpc";
import { router } from "../index";

export const moneyRouter = router({
  payments: teamProcedureFor(paymentList),
  cases: teamProcedureFor(disputeList),
});
