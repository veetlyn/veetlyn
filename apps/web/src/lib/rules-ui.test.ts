// @vitest-environment happy-dom
import { fromPartial } from "@total-typescript/shoehorn";
import { QueryClientProvider } from "@tanstack/react-query";
import { RulebookEditor } from "@opmodel/admin-rules/RulebookEditor";
import { AGENCY_RULEBOOK_SPEC, RulebookRulesSchema, type RulebookSpec } from "@opmodel/engine-rules";
import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

import TeamRules from "../app/dash/[storeSlug]/rules/team-rules";
import { queryClient, trpc } from "../utils/trpc";

type Outputs = inferRouterOutputs<AppRouter>;
type RulesState = Outputs["rules"]["state"];

let container: HTMLDivElement;
let root: Root;
let releasePendingSave: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  releasePendingSave = undefined;
});

afterEach(async () => {
  await act(async () => {
    releasePendingSave?.();
    root.unmount();
  });
  queryClient.clear();
  container.remove();
  vi.unstubAllGlobals();
});

function inputFor(labelText: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll("label")).find((entry) => entry.textContent?.trim().startsWith(labelText));
  const input = label?.querySelector("input");
  if (!input) throw new Error(`Missing input: ${labelText}`);
  return input;
}

function enterValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Missing native input setter");
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function isDisabled(input: HTMLInputElement): boolean {
  return input.disabled || input.closest("fieldset[disabled]") !== null;
}

it("keeps the tier amount input mounted and focused through successive edits", async () => {
  function Editor() {
    const [spec, setSpec] = useState<RulebookSpec>(AGENCY_RULEBOOK_SPEC);
    return createElement(RulebookEditor, { spec, currency: "USD", onChange: setSpec, onPublish: () => {} });
  }
  await act(async () => root.render(createElement(Editor)));
  const input = inputFor("From quote (USD)");
  input.focus();
  await act(async () => enterValue(input, "1001"));
  expect(inputFor("From quote (USD)").value).toBe("1001");
  expect(document.activeElement).toBe(input);
  await act(async () => enterValue(input, "10012"));
  expect(inputFor("From quote (USD)")).toBe(input);
  expect(input.value).toBe("10012");
  expect(document.activeElement).toBe(input);
});

it("locks the draft editor during a deferred first save and permits edits after the saved draft arrives", async () => {
  let serverState: RulesState = {
    published: { id: "published-v1", version: 1, ...AGENCY_RULEBOOK_SPEC },
    draft: null,
    memberAccepted: true,
    summaries: { clientTerms: "", memberAgreement: "", compact: "" },
    projectNoticesEnabled: true,
    leavingNoticeEffectiveAt: null,
  };
  queryClient.setQueryData(trpc.rules.state.queryKey({ teamSlug: "team" }), serverState);
  queryClient.setQueryData(trpc.servicesTeam.get.queryKey({ teamSlug: "team" }), fromPartial<Outputs["servicesTeam"]["get"]>({
    role: "admin", settings: { currency: "USD" },
  }));

  let releaseSave = () => {};
  let startSave = () => {};
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  releasePendingSave = releaseSave;
  const saveStarted = new Promise<void>((resolve) => { startSave = resolve; });
  const draftInput = z.record(z.string(), z.strictObject({
    teamSlug: z.string(), preset: z.enum(["solo", "agency", "collective", "custom"]), rules: RulebookRulesSchema,
  }));
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(z.string().parse(input), "https://platform.test");
    if (url.pathname === "/trpc/rules.saveDraft") {
      const submitted = draftInput.parse(JSON.parse(z.string().parse(init?.body)))["0"];
      if (!submitted) throw new Error("Missing submitted draft");
      startSave();
      await saveGate;
      serverState = { ...serverState, draft: { id: "draft-v2", version: 2, preset: submitted.preset, rules: submitted.rules } };
      return Response.json([{ result: { data: serverState.draft } }]);
    }
    if (url.pathname === "/trpc/rules.state") return Response.json([{ result: { data: serverState } }]);
    throw new Error(`Unexpected RPC: ${url.pathname}`);
  }));

  await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(TeamRules, { teamSlug: "team" }))));
  await act(async () => enterValue(inputFor("Free rounds"), "3"));
  const save = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save draft");
  if (!save) throw new Error("Missing save draft button");
  await act(async () => {
    save.click();
    await saveStarted;
  });
  expect(isDisabled(inputFor("Free rounds"))).toBe(true);
  expect(isDisabled(inputFor("From quote (USD)"))).toBe(true);
  await act(async () => releaseSave());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(isDisabled(inputFor("Free rounds"))).toBe(false);
    expect(queryClient.getQueryData<RulesState>(trpc.rules.state.queryKey({ teamSlug: "team" }))?.draft?.id).toBe("draft-v2");
  });
  expect(inputFor("Free rounds").value).toBe("3");
  await act(async () => enterValue(inputFor("Free rounds"), "4"));
  expect(inputFor("Free rounds").value).toBe("4");
});
