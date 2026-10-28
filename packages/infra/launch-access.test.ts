import { describe, expect, it } from "vitest";
import { launchAccess } from "./launch-access.ts";

describe("deployment launch access", () => {
  it("keeps production closed when the variable is absent or empty", () => {
    expect(launchAccess("production", undefined)).toBe("waitlist");
    expect(launchAccess("production", "")).toBe("waitlist");
  });
  it("keeps staging and local demos open by default", () => {
    expect(launchAccess("staging", undefined)).toBe("open");
    expect(launchAccess(undefined, undefined)).toBe("open");
  });
  it("allows an explicit launch and refuses misspelled access settings", () => {
    expect(launchAccess("production", "open")).toBe("open");
    expect(() => launchAccess("production", "opened")).toThrow();
  });
});
