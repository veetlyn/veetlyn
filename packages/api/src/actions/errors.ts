import { ProjectConflictError } from "@jendal-workspace/db/repositories/unit-of-work";
import { TRPCError } from "@trpc/server";

export type ActionErrorCode =
  | "invalid"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "precondition_failed"
  | "rate_limited"
  | "unavailable"
  | "internal";

type TRPCCode = TRPCError["code"];

const GENERIC_INTERNAL = "Something went wrong. Try again in a moment.";

export class ActionError extends Error {
  readonly code: ActionErrorCode;
  readonly details?: Record<string, string[]>;
  readonly trpcCode?: TRPCCode;
  readonly expose: boolean;

  constructor(
    code: ActionErrorCode,
    message: string,
    options: { details?: Record<string, string[]>; trpcCode?: TRPCCode; expose?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ActionError";
    this.code = code;
    this.details = options.details;
    this.trpcCode = options.trpcCode;
    this.expose = options.expose ?? code !== "internal";
  }
}

function fromTRPCCode(code: TRPCCode): ActionErrorCode {
  switch (code) {
    case "BAD_REQUEST":
    case "PARSE_ERROR":
      return "invalid";
    case "NOT_FOUND":
      return "not_found";
    case "FORBIDDEN":
    case "UNAUTHORIZED":
      return "forbidden";
    case "CONFLICT":
      return "conflict";
    case "PRECONDITION_FAILED":
      return "precondition_failed";
    case "TOO_MANY_REQUESTS":
      return "rate_limited";
    case "BAD_GATEWAY":
    case "SERVICE_UNAVAILABLE":
    case "GATEWAY_TIMEOUT":
      return "unavailable";
    default:
      return "internal";
  }
}

const TO_TRPC = {
  invalid: "BAD_REQUEST",
  not_found: "NOT_FOUND",
  forbidden: "FORBIDDEN",
  conflict: "CONFLICT",
  precondition_failed: "PRECONDITION_FAILED",
  rate_limited: "TOO_MANY_REQUESTS",
  unavailable: "BAD_GATEWAY",
  internal: "INTERNAL_SERVER_ERROR",
} as const satisfies Record<ActionErrorCode, TRPCCode>;

export function toActionError(cause: unknown): ActionError {
  if (cause instanceof ActionError) {
    return cause.expose ? cause : new ActionError("internal", GENERIC_INTERNAL, { cause, trpcCode: cause.trpcCode });
  }
  if (cause instanceof TRPCError) {
    const code = fromTRPCCode(cause.code);
    const message = code === "internal" ? GENERIC_INTERNAL : cause.message;
    return new ActionError(code, message, { trpcCode: cause.code, cause, expose: code !== "internal" });
  }
  if (cause instanceof ProjectConflictError) return new ActionError("conflict", cause.message, { cause });
  return new ActionError("internal", GENERIC_INTERNAL, { cause });
}

export function toTRPCError(error: ActionError): TRPCError {
  return new TRPCError({ code: error.trpcCode ?? TO_TRPC[error.code], message: error.message, cause: error });
}
