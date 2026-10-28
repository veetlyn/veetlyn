import { describe, expect, it } from "vitest";
import { z } from "zod";

import { type AnyActionDefinition, agentPolicyOf } from "./define";
import { ACTIONS } from "./registry";

function find(name: string): AnyActionDefinition {
  const action = ACTIONS.find((a) => a.name === name);
  if (!action) throw new Error(`No action named ${name}`);
  return action;
}

describe("action registry", () => {
  it("has unique names and a summary for every action", () => {
    const names = ACTIONS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const action of ACTIONS) expect(action.summary.length).toBeGreaterThan(20);
  });

  it("exports every input and output as JSON Schema", () => {
    for (const action of ACTIONS) {
      expect(() => z.toJSONSchema(action.input, { io: "input" }), action.name).not.toThrow();
      const { output } = action;
      if (output) expect(() => z.toJSONSchema(output), action.name).not.toThrow();
    }
  });

  it("keeps definitions without an output on the web only", () => {
    for (const action of ACTIONS.filter((a) => a.output === null)) expect(action.surfaces).toEqual(["web"]);
  });

  it("never lets an agent commit the client or move money on its own", () => {
    const committing = [
      "quote.accept",
      "amendment.accept",
      "delivery.accept",
      "project.refund_client",
      "quote.create",
      "delivery.submit",
    ];
    for (const name of committing) expect(agentPolicyOf(find(name)), name).not.toBe("free");
    for (const name of ["project.refund_client", "project.late_refund.decide", "project.quality_refund.set"]) {
      expect(agentPolicyOf(find(name)), name).toBe("never");
    }
  });

  it("lets only team members change a project's clients, an agent only with a confirmation", () => {
    for (const name of ["project.client.add", "project.client.remove", "project.client_link.email", "project.client_link.reissue"]) {
      expect(find(name).allow, name).toEqual([{ grant: "member" }]);
      expect(agentPolicyOf(find(name)), name).toBe("confirm");
    }
    expect(find("project.client_preview")).toMatchObject({ kind: "query", allow: [{ grant: "member" }], surfaces: ["web"] });
  });

  it("puts every payout decision behind a person, and payout credentials beyond an agent", () => {
    for (const name of ["payout.approve", "payout.reject", "payout.retry", "payout.rules.save", "payout.rules.preset", "payout.web.export"]) {
      expect(find(name).allow, name).toEqual([{ grant: "member" }]);
      expect(agentPolicyOf(find(name)), name).toBe("confirm");
    }
    for (const name of ["payout.connect.start", "payout.connect.complete", "payout.credentials.remove", "payout.web.import"]) {
      expect(agentPolicyOf(find(name)), name).toBe("never");
    }
    for (const name of ["payout.list", "payout.rules.get", "payout.credentials.get"]) {
      expect(find(name)).toMatchObject({ kind: "query", allow: [{ grant: "member" }] });
    }
    expect(find("payout.request").allow).toEqual([{ grant: "signed_in" }]);
    expect(find("payout.mine")).toMatchObject({ kind: "query", allow: [{ grant: "signed_in" }] });
  });

  it("leaves declining a request to a person and answering questions to the client", () => {
    expect(agentPolicyOf(find("request.decline"))).toBe("never");
    expect(find("request.decline").allow).toEqual([{ grant: "member" }]);
    expect(find("conversation.answer").allow).toEqual([{ grant: "client" }]);
  });
});
