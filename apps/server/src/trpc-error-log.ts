import { PayPalError } from "@jendal-workspace/paypal";
import type { TRPCError } from "@trpc/server";

export type TrpcErrorContext = {
  error: Error;
  fields: {
    trpc: { path: string; code: TRPCError["code"] };
    paypal?: {
      status: number;
      name: string;
      debugId: string | undefined;
      details: { issue: string | undefined; field: string | undefined }[];
    };
  };
};

// Client errors (4xx codes) are already explained to the caller; only server errors need a log trail.
// PayPal detail values can echo request data, so only the issue and the field are kept.
export function trpcErrorContext(error: TRPCError, path: string | undefined): TrpcErrorContext | null {
  if (error.code !== "INTERNAL_SERVER_ERROR") return null;
  const cause = error.cause instanceof Error ? error.cause : error;
  const fields: TrpcErrorContext["fields"] = { trpc: { path: path ?? "unknown", code: error.code } };
  if (cause instanceof PayPalError) {
    fields.paypal = {
      status: cause.status,
      name: cause.name,
      debugId: cause.debugId,
      details: cause.details.map((detail) => ({ issue: detail.issue, field: detail.field })),
    };
  }
  return { error: cause, fields };
}
