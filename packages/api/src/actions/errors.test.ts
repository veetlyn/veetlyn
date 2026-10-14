import { ProjectConflictError, ProjectStateError } from "@jendal-workspace/db/repositories/unit-of-work";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { ActionError, toActionError, toTRPCError } from "./errors";

describe("toActionError", () => {
  it.each([
    [new TRPCError({ code: "BAD_REQUEST", message: "Give the project a title." }), "invalid", "Give the project a title."],
    [new TRPCError({ code: "NOT_FOUND", message: "Project not found." }), "not_found", "Project not found."],
    [new TRPCError({ code: "FORBIDDEN", message: "Only admins and managers start projects." }), "forbidden", "Only admins and managers start projects."],
    [new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" }), "forbidden", "Authentication required"],
    [new TRPCError({ code: "CONFLICT", message: "The project changed while you worked. Reload and try again." }), "conflict", "The project changed while you worked. Reload and try again."],
    [new TRPCError({ code: "PRECONDITION_FAILED", message: "Requests are not available right now." }), "precondition_failed", "Requests are not available right now."],
    [new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: "PayPal declined this payment method. Choose another way to pay." }), "precondition_failed", "PayPal declined this payment method. Choose another way to pay."],
    [new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests. Wait a little and try again." }), "rate_limited", "Too many requests. Wait a little and try again."],
    [new TRPCError({ code: "BAD_GATEWAY", message: "PayPal did not answer." }), "unavailable", "PayPal did not answer."],
    [new ProjectConflictError(), "conflict", "The project changed; refresh and try again."],
  ])("maps %s to %s", (thrown, code, message) => {
    const error = toActionError(thrown);
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
  });

  it("hides the message of an unexpected internal failure", () => {
    const error = toActionError(new ProjectStateError("The transaction applied no change to a project"));
    expect(error.code).toBe("internal");
    expect(error.message).toBe("Something went wrong. Try again in a moment.");
  });

  it("hides the message of an internal action error that was not exposed", () => {
    const error = toActionError(new ActionError("internal", "pg: relation x does not exist"));
    expect(error.code).toBe("internal");
    expect(error.message).toBe("Something went wrong. Try again in a moment.");
  });

  it("hides the message of a tRPC internal error", () => {
    const error = toActionError(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "pg: relation x does not exist" }));
    expect(error.code).toBe("internal");
    expect(error.message).toBe("Something went wrong. Try again in a moment.");
  });

  it("keeps a deliberate internal message", () => {
    const error = toActionError(new ActionError("internal", "We could not send the email. Try again in a moment.", { expose: true }));
    expect(error.message).toBe("We could not send the email. Try again in a moment.");
  });
});

describe("toTRPCError", () => {
  it("returns the tRPC code the use case threw", () => {
    const error = toTRPCError(toActionError(new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" })));
    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.message).toBe("Authentication required");
  });

  it("maps codes that did not come from tRPC", () => {
    expect(toTRPCError(new ActionError("forbidden", "Agents cannot do this yet.")).code).toBe("FORBIDDEN");
    expect(toTRPCError(new ActionError("internal", "We could not send the email. Try again in a moment.", { expose: true })).code).toBe("INTERNAL_SERVER_ERROR");
  });
});
