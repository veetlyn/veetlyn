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
  projectClientView,
  projectGet,
  projectList,
  projectRefundClient,
  projectStart,
} from "./projects";
import { offeringSearch } from "./offerings";
import { amendmentAccept, amendmentDecline, amendmentPropose, quoteAccept, quoteCreate } from "./quotes";
import { createRequest } from "./requests";

export const ACTIONS: readonly AnyActionDefinition[] = [
  createRequest,
  projectStart,
  projectAssign,
  projectRefundClient,
  projectList,
  projectGet,
  projectClientView,
  projectClientAdd,
  projectClientRemove,
  projectClientLinkEmail,
  projectClientLinkReissue,
  projectClientPreview,
  quoteCreate,
  quoteAccept,
  amendmentPropose,
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
];
