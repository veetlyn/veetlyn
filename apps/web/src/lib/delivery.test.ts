import { describe, expect, it } from "vitest";
import { deliveryDraftProblem, deliveryStaffStatusLabel, deliveryStatusLabel, newestFirst, safeHttpsLink } from "./delivery";

describe("deliveryDraftProblem", () => {
  it("needs a note or an https link", () => {
    expect(deliveryDraftProblem({ note: "", link: "", file: null })).toBe("Add a note, a link or a file.");
    expect(deliveryDraftProblem({ note: "Done", link: "", file: null })).toBeNull();
    expect(deliveryDraftProblem({ note: "", link: "https://figma.com/file/1", file: null })).toBeNull();
    expect(deliveryDraftProblem({ note: "", link: "http://figma.com", file: null })).toBe("Use an https link.");
    expect(deliveryDraftProblem({ note: "", link: "not a url", file: null })).toBe("Use an https link.");
  });

  it("trims before checking, like the server", () => {
    expect(deliveryDraftProblem({ note: "   ", link: "  \n", file: null })).toBe("Add a note, a link or a file.");
    expect(deliveryDraftProblem({ note: "", link: "  https://figma.com/file/1  ", file: null })).toBeNull();
  });

  it("checks the link even when there is a note", () => {
    expect(deliveryDraftProblem({ note: "Done", link: "ftp://files.example.com", file: null })).toBe("Use an https link.");
  });

  it("accepts a file on its own and checks it like the server", () => {
    expect(deliveryDraftProblem({ note: "", link: "", file: { name: "a.pdf", size: 10 } })).toBeNull();
    expect(deliveryDraftProblem({ note: "", link: "", file: { name: "run.exe", size: 10 } })).toBe("This file type is not allowed.");
    expect(deliveryDraftProblem({ note: "", link: "", file: { name: "a.pdf", size: 100 * 1024 * 1024 + 1 } })).toBe(
      "Files can be up to 100 MB.",
    );
    expect(deliveryDraftProblem({ note: "", link: "", file: { name: "a.pdf", size: 0 } })).toBe("The file is empty.");
  });

  it("checks the file even when there is a note", () => {
    expect(deliveryDraftProblem({ note: "Done", link: "", file: { name: "run.exe", size: 10 } })).toBe("This file type is not allowed.");
  });

  it("caps the note at 5000 characters and the link at 2000", () => {
    expect(deliveryDraftProblem({ note: "a".repeat(5000), link: "", file: null })).toBeNull();
    expect(deliveryDraftProblem({ note: "a".repeat(5001), link: "", file: null })).toBe("The note is too long.");
    const base = "https://example.com/";
    expect(deliveryDraftProblem({ note: "", link: base + "a".repeat(2000 - base.length), file: null })).toBeNull();
    expect(deliveryDraftProblem({ note: "", link: base + "a".repeat(2001 - base.length), file: null })).toBe("Use an https link.");
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

describe("safeHttpsLink", () => {
  it("keeps https links and drops anything else", () => {
    expect(safeHttpsLink("https://figma.com/file/1")).toBe("https://figma.com/file/1");
    expect(safeHttpsLink("javascript:alert(1)")).toBeNull();
    expect(safeHttpsLink("http://figma.com")).toBeNull();
    expect(safeHttpsLink("not a url")).toBeNull();
    expect(safeHttpsLink(null)).toBeNull();
  });
});
