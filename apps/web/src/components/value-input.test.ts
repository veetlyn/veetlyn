// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ValueInput } from "./value-input";

describe("value-aware inputs", () => {
  it("shows the percent unit without changing the decimal text accepted by the existing parser", () => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(createElement(ValueInput, { id: "rate", unit: "%", unitLabel: "percent", defaultValue: "2,5", "aria-describedby": "rate-help" }));
    const input = root.querySelector("input");
    expect(input?.value).toBe("2,5");
    expect(input?.inputMode).toBe("decimal");
    expect(input?.getAttribute("aria-describedby")?.split(" ")).toEqual(["rate-help", "rate-unit"]);
    expect(root.querySelector("#rate-unit")?.textContent).toBe("percent");
    expect(root.textContent).toContain("%");
  });

  it("retains integer bounds for whole-day values", () => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(createElement(ValueInput, { id: "hold", unit: "days", type: "number", inputMode: "numeric", min: 0, max: 90, step: 1, defaultValue: "7" }));
    const input = root.querySelector("input");
    expect(input?.type).toBe("number");
    expect(input?.min).toBe("0");
    expect(input?.max).toBe("90");
    expect(input?.step).toBe("1");
    expect(input?.inputMode).toBe("numeric");
    expect(root.querySelector("#hold-unit")?.textContent).toBe("days");
  });
});
