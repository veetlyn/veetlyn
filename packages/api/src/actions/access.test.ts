import { isClassifiedAction } from "@jendal-workspace/core";
import { expect, it } from "vitest";
import { z } from "zod";

import * as clients from "./clients";
import * as conversations from "./conversations";
import * as deliveries from "./deliveries";
import * as money from "./money";
import * as offerings from "./offerings";
import * as payouts from "./payouts";
import * as projects from "./projects";
import * as quotes from "./quotes";
import * as requests from "./requests";
import * as sellers from "./sellers";

const teamAction = z.object({ name: z.string(), allow: z.array(z.object({ grant: z.string() })) });

// A new team action has to say which limits apply to it. Until it does, it is refused to anyone with limits.
it("classifies every action a team member can run", () => {
  const actions = [clients, conversations, deliveries, money, offerings, payouts, projects, quotes, requests, sellers]
    .flatMap((module) => Object.values(module))
    .flatMap((value) => {
      const action = teamAction.safeParse(value);
      return action.success ? [action.data] : [];
    })
    .filter((action) => action.allow.some((grant) => grant.grant === "member"));
  expect(actions.length).toBeGreaterThan(40);
  expect(actions.map((action) => action.name).filter((name) => !isClassifiedAction(name))).toEqual([]);
});
