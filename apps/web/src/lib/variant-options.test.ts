import { describe, expect, it } from "vitest";

import { variantLabel } from "./variant-options";

describe("variantLabel", () => {
  it("labels an option-less variant as Default", () => {
    expect(variantLabel([])).toBe("Default");
  });

  it("joins options with slashes", () => {
    expect(
      variantLabel([
        { name: "Color", value: "Red" },
        { name: "Size", value: "M" },
      ]),
    ).toBe("Color: Red / Size: M");
  });
});
