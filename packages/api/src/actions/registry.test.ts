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
    expect(agentPolicyOf(find("project.refund_client"))).toBe("never");
  });

  it("lets only team members change a project's clients, an agent only with a confirmation", () => {
    for (const name of ["project.client.add", "project.client.remove", "project.client_link.email", "project.client_link.reissue"]) {
      expect(find(name).allow, name).toEqual([{ grant: "member" }]);
      expect(agentPolicyOf(find(name)), name).toBe("confirm");
    }
    expect(find("project.client_preview")).toMatchObject({ kind: "query", allow: [{ grant: "member" }], surfaces: ["web"] });
  });
});
