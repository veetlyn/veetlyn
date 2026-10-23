import { describe, expect, it } from "vitest";

import { slugStatus } from "./slug-status";

const url = (slug: string) => `https://${slug}.platform.site`;

describe("slugStatus", () => {
  it("shows nothing for an empty address", () => {
    expect(slugStatus("", undefined, url)).toBeNull();
  });

  it("shows a pending message until the check for this address returns", () => {
    expect(slugStatus("acme", undefined, url)).toEqual({ tone: "pending", text: "Checking the address…" });
  });

  it("shows the full URL when the address is available", () => {
    expect(slugStatus("acme", { status: "available", slug: "acme" }, url)).toEqual({
      tone: "available",
      text: "https://acme.platform.site is available.",
    });
  });

  it("explains taken and invalid addresses", () => {
    expect(slugStatus("acme", { status: "taken", slug: "acme" }, url)).toEqual({
      tone: "problem",
      text: "This store address is already taken.",
    });
    expect(slugStatus("login", { status: "invalid", reason: "reserved" }, url)).toEqual({
      tone: "problem",
      text: "This store address is reserved.",
    });
  });

  it("words the problems for services teams", () => {
    expect(slugStatus("acme", { status: "taken", slug: "acme" }, url, "services")).toEqual({
      tone: "problem",
      text: "This team address is already taken.",
    });
    expect(slugStatus("login", { status: "invalid", reason: "reserved" }, url, "services")).toEqual({
      tone: "problem",
      text: "This team address is reserved.",
    });
  });
});
