import { describe, expect, it } from "vitest";
import { deliveryDraftProblem, deliveryStaffStatusLabel, deliveryStatusLabel, newestFirst } from "./delivery";

describe("deliveryDraftProblem", () => {
  it("needs a note or an https link", () => {
    expect(deliveryDraftProblem({ note: "", link: "" })).toBe("Add a note or a link.");
    expect(deliveryDraftProblem({ note: "Done", link: "" })).toBeNull();
    expect(deliveryDraftProblem({ note: "", link: "https://figma.com/file/1" })).toBeNull();
    expect(deliveryDraftProblem({ note: "", link: "http://figma.com" })).toBe("Use an https link.");
    expect(deliveryDraftProblem({ note: "", link: "not a url" })).toBe("Use an https link.");
  });

  it("trims before checking, like the server", () => {
    expect(deliveryDraftProblem({ note: "   ", link: "  \n" })).toBe("Add a note or a link.");
    expect(deliveryDraftProblem({ note: "", link: "  https://figma.com/file/1  " })).toBeNull();
  });

  it("checks the link even when there is a note", () => {
    expect(deliveryDraftProblem({ note: "Done", link: "ftp://files.example.com" })).toBe("Use an https link.");
  });

  it("caps the note at 5000 characters and the link at 2000", () => {
    expect(deliveryDraftProblem({ note: "a".repeat(5000), link: "" })).toBeNull();
    expect(deliveryDraftProblem({ note: "a".repeat(5001), link: "" })).toBe("The note is too long.");
    const base = "https://example.com/";
    expect(deliveryDraftProblem({ note: "", link: base + "a".repeat(2000 - base.length) })).toBeNull();
    expect(deliveryDraftProblem({ note: "", link: base + "a".repeat(2001 - base.length) })).toBe("Use an https link.");
  });
});

describe("deliveryStatusLabel", () => {
  it("names each state for the client", () => {
    expect(deliveryStatusLabel("submitted")).toBe("Waiting for your answer");
    expect(deliveryStatusLabel("accepted")).toBe("Accepted");
    expect(deliveryStatusLabel("changes_requested")).toBe("Changes requested");
  });
});

describe("deliveryStaffStatusLabel", () => {
  it("names each state for the team", () => {
    expect(deliveryStaffStatusLabel("submitted")).toBe("Waiting for the client");
    expect(deliveryStaffStatusLabel("accepted")).toBe("Accepted");
    expect(deliveryStaffStatusLabel("changes_requested")).toBe("Changes requested");
  });
});

describe("newestFirst", () => {
  it("orders by creation date, newest first, without changing the input", () => {
    const input = [
      { id: "a", createdAt: "2026-01-01T10:00:00.000Z" },
      { id: "c", createdAt: "2026-01-03T10:00:00.000Z" },
      { id: "b", createdAt: new Date("2026-01-02T10:00:00.000Z") },
    ];
    expect(newestFirst(input).map((d) => d.id)).toEqual(["c", "b", "a"]);
    expect(input.map((d) => d.id)).toEqual(["a", "c", "b"]);
  });
});
