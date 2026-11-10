import { describe, expect, it } from "vitest";

import { defineMachine, InvalidTransitionError, machineDiagram, transitionOrThrow } from "./machine";

const door = defineMachine({
  name: "door",
  states: ["open", "closed", "locked", "removed"],
  initial: "closed",
  transitions: {
    open: { from: ["closed"], to: "open" },
    close: { from: ["open"], to: "closed" },
    lock: { from: ["closed"], to: "locked" },
    unlock: { from: ["locked"], to: "closed" },
    remove: { from: ["open", "closed"], to: "removed" },
  },
});

describe("defineMachine", () => {
  it("allows only the listed moves and derives what follows from the table", () => {
    expect(door.next("closed", "open")).toBe("open");
    expect(door.next("locked", "open")).toBeNull();
    expect(door.allowedEvents("closed")).toEqual(["open", "lock", "remove"]);
    expect(door.sources("remove")).toEqual(["open", "closed"]);
    expect(door.terminal).toEqual(["removed"]);
    expect(door.isTerminal("locked")).toBe(false);
  });

  it("throws a typed error for a refused move", () => {
    expect(transitionOrThrow(door, "open", "close")).toBe("closed");
    expect(() => transitionOrThrow(door, "removed", "open")).toThrow(InvalidTransitionError);
  });

  it("rejects a table that names a state it does not declare", () => {
    expect(() =>
      defineMachine({
        name: "broken",
        states: ["a"],
        initial: "a",
        // SAFETY: deliberately outside the declared states to exercise the runtime check.
        transitions: { go: { from: ["a"], to: "b" as "a" } },
      }),
    ).toThrow(/unknown state "b"/);
  });

  it("draws every row of the table", () => {
    expect(machineDiagram(door)).toContain("open --> removed: remove");
    expect(machineDiagram(door)).toContain("removed --> [*]");
  });
});
