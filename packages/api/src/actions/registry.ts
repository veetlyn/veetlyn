import {
  projectClientAdd,
  projectClientLinkEmail,
  projectClientLinkReissue,
  projectClientPreview,
  projectClientRemove,
} from "./clients";
import {
  conversationAnswer,
  conversationPost,
  memberDepartments,
  requestDecline,
  requestListOpen,
  requestShortlist,
} from "./conversations";
import type { AnyActionDefinition } from "./define";
import { deliveryAccept, deliveryFile, deliveryRequestChanges, deliverySubmit, deliveryUploadStart } from "./deliveries";
import {
  projectAssign,
  projectClientList,
  projectClientView,
  projectGet,
  projectLateRefundDecide,
  projectList,
  projectQualityRefundSet,
  projectRefundClient,
  projectStart,
  projectWarningRecord,
  teamMembers,
} from "./projects";
import { MONEY_ACTIONS } from "./money";
import { offeringSearch } from "./offerings";
import { PAYOUT_ACTIONS } from "./payouts";
import { amendmentAccept, amendmentDecline, amendmentOfferPaidRevision, amendmentPropose, quoteAccept, quoteCreate } from "./quotes";
import { createRequest, requestTerms } from "./requests";
import { REVIEW_ACTIONS } from "./reviews";
import { SELLER_ACTIONS } from "./sellers";

export const ACTIONS: readonly AnyActionDefinition[] = [
  createRequest,
  requestTerms,
  projectStart,
  projectAssign,
  projectRefundClient,
  projectLateRefundDecide,
  projectQualityRefundSet,
  projectWarningRecord,
  projectList,
  projectGet,
  teamMembers,
  projectClientView,
  projectClientList,
  projectClientAdd,
  projectClientRemove,
  projectClientLinkEmail,
  projectClientLinkReissue,
  projectClientPreview,
  quoteCreate,
  quoteAccept,
  amendmentPropose,
  amendmentOfferPaidRevision,
  amendmentAccept,
  amendmentDecline,
  deliveryUploadStart,
  deliverySubmit,
  deliveryRequestChanges,
  deliveryAccept,
  deliveryFile,
  conversationPost,
  conversationAnswer,
  requestDecline,
  requestShortlist,
  memberDepartments,
  requestListOpen,
  offeringSearch,
  ...PAYOUT_ACTIONS,
  ...MONEY_ACTIONS,
  ...SELLER_ACTIONS,
  ...REVIEW_ACTIONS,
];
