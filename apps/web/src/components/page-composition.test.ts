// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContextRail, DocumentPage, ListPage, SummaryStrip, WorkPage } from "./page-composition";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("page composition", () => {
  it("puts the work column, context rail and composer in one aligned work layout", async () => {
    await act(async () =>
      root.render(
        createElement(WorkPage, {
          rail: createElement(ContextRail, { label: "Project facts", children: "Facts" }),
          composer: createElement("p", null, "Composer"),
          children: createElement("p", null, "Work"),
        }),
      ),
    );
    const main = container.querySelector("main");
    expect(main?.dataset.composition).toBe("work");
    expect(main?.querySelector("[data-work-column]")?.textContent).toContain("Work");
    expect(main?.querySelector("[data-composer-slot]")?.textContent).toContain("Composer");
    expect(container.querySelector("aside[aria-label='Project facts']")?.textContent).toContain("Facts");
    // The composer lives inside the work column, so it aligns with the content above it.
    expect(main?.querySelector("[data-work-column] [data-composer-slot]")).not.toBeNull();
  });

  it("gives document and list pages their own named layouts", async () => {
    await act(async () => root.render(createElement(DocumentPage, { children: createElement("p", null, "Document") })));
    expect(container.querySelector("main")?.dataset.composition).toBe("document");
    await act(async () => root.render(createElement(ListPage, { children: createElement("p", null, "List") })));
    expect(container.querySelector("main")?.dataset.composition).toBe("list");
  });

  it("renders a summary strip as the page's first named region", async () => {
    await act(async () => root.render(createElement(SummaryStrip, { label: "Needs attention", children: "2 payouts need approval" })));
    const strip = container.querySelector("[role='region'][aria-label='Needs attention']");
    expect(strip?.textContent).toContain("2 payouts need approval");
  });
});
