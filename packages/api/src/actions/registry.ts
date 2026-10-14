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
];
