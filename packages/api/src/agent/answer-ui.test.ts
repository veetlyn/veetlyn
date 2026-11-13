import { describe, expect, it } from "vitest";

import { sanitizeAgentAnswer } from "./answer";
import { blocksToSpec, ID_SOURCES, presentInput, recordIdsIn, specSummary } from "./answer-ui";

describe("the assistant's answer UI", () => {
  it("turns present blocks into a json-render spec under one Answer root, in order", () => {
    const { blocks } = presentInput.parse({
      blocks: [
        { type: "figures", items: [{ label: "Payouts to approve", amountMinor: 12750, currency: "USD", hint: "1 request" }] },
        {
          type: "records",
          title: "Needs your answer",
          items: [{ kind: "project", id: "f5349023-c16c-48bb-a849-c84ed6dc63d9", title: "Logo refresh", detail: "Rita Client", tone: "attention" }],
        },
      ],
    });
    const spec = blocksToSpec(blocks, sanitizeAgentAnswer);
    expect(spec?.root).toBe("answer");
    expect(spec?.elements.answer).toEqual({ type: "Answer", props: {}, children: ["figures-0", "records-1"] });
    expect(spec?.elements["figures-0"]?.props).toEqual({ items: [{ label: "Payouts to approve", hint: "1 request", amountMinor: 12750, currency: "USD" }] });
    expect(spec && specSummary(spec)).toBe("Figures, Records");
  });

  it("cleans internal ids out of shown text but keeps a row's id for its link", () => {
    const id = "f5349023-c16c-48bb-a849-c84ed6dc63d9";
    const { blocks } = presentInput.parse({ blocks: [{ type: "records", items: [{ kind: "project", id, title: `Logo refresh ${id}` }] }] });
    expect(blocksToSpec(blocks, sanitizeAgentAnswer)?.elements["records-0"]?.props).toEqual({ items: [{ kind: "project", id, title: "Logo refresh" }] });
  });

  it("drops money without a currency instead of guessing one, and fits table rows to their columns", () => {
    const { blocks } = presentInput.parse({
      blocks: [
        { type: "figures", items: [{ label: "Collected", amountMinor: 134500 }] },
        { type: "table", columns: [{ label: "Freelancer" }, { label: "Price", align: "right" }], rows: [["Aïcha Walk", "$150.00", "extra"], ["Ben Walk"]] },
      ],
    });
    const spec = blocksToSpec(blocks, sanitizeAgentAnswer);
    expect(spec?.elements.answer?.children).toEqual(["table-1"]);
    expect(spec?.elements["table-1"]?.props.rows).toEqual([["Aïcha Walk", "$150.00"], ["Ben Walk", ""]]);
  });

  it("refuses links that are not record ids", () => {
    expect(presentInput.safeParse({ blocks: [{ type: "next", items: [{ label: "Open", kind: "project", id: "https://evil.example" }] }] }).success).toBe(false);
  });

  // Walk 2026-11-12: a project's id was presented as a payout, which would have linked to a missing payout page.
  it("keeps a row's id only when a tool of that kind returned it", () => {
    const seen = new Map([["proj-1", "project_list"]]);
    const known = (kind: keyof typeof ID_SOURCES, id: string) => ID_SOURCES[kind].some((source) => source === seen.get(id));
    const { blocks } = presentInput.parse({
      blocks: [{ type: "records", items: [{ kind: "payout", id: "proj-1", title: "Earnings" }, { kind: "project", id: "proj-1", title: "Logo refresh" }] }],
    });
    expect(blocksToSpec(blocks, sanitizeAgentAnswer, known)?.elements["records-0"]?.props.items).toEqual([
      { kind: "payout", title: "Earnings" },
      { kind: "project", id: "proj-1", title: "Logo refresh" },
    ]);
    expect(recordIdsIn(JSON.stringify([{ id: "a1", project: { id: "b2" } }]))).toEqual(["a1"]);
    expect(recordIdsIn(JSON.stringify({ id: "p1", deliveries: [{ id: "d1" }] }))).toEqual(["p1", "d1"]);
    expect(recordIdsIn("not json")).toEqual([]);
  });
});
