import { isTerminalProjectStatus, PROJECT_STATUSES } from "@jendal-workspace/core";
import { describe, expect, it } from "vitest";

import { TEAM_PROJECT_NEXT_STEP } from "./project-next-step";

describe("TEAM_PROJECT_NEXT_STEP", () => {
  it("names a next step for every open status and none for closed ones", () => {
    for (const status of PROJECT_STATUSES) {
      expect(TEAM_PROJECT_NEXT_STEP[status] === null).toBe(isTerminalProjectStatus(status));
    }
  });
});
