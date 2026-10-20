import { describe, expect, it } from "vitest";

import { type AccessFacts, conversationAccess, type ConversationAccess, readableSpaces, type Viewer } from "./access";

const DESIGN = "dept-design";
const quoting: AccessFacts = {
  quotingMode: "open",
  departmentId: DESIGN,
  shortlist: [],
  status: "quoting",
  assignedFreelancerId: null,
};
const accepted: AccessFacts = { ...quoting, status: "awaiting_deposit", assignedFreelancerId: "aicha" };

const admin: Viewer = { kind: "member", role: "admin", userId: "boss", departmentIds: [] };
const manager: Viewer = { kind: "member", role: "manager", userId: "mia", departmentIds: [] };
const aicha: Viewer = { kind: "member", role: "freelancer", userId: "aicha", departmentIds: [DESIGN] };
const ben: Viewer = { kind: "member", role: "freelancer", userId: "ben", departmentIds: [DESIGN] };
const outsider: Viewer = { kind: "member", role: "freelancer", userId: "olu", departmentIds: ["dept-video"] };
const client: Viewer = { kind: "client" };
const stranger: Viewer = { kind: "stranger" };

const NONE: ConversationAccess = { read: [], write: [] };
const REQUEST_ONLY: ConversationAccess = { read: ["request"], write: ["request"] };
const STAFF_QUOTING: ConversationAccess = { read: ["request", "project"], write: ["request", "project"] };
const STAFF_AFTER: ConversationAccess = { read: ["request", "project"], write: ["project"] };
const PROJECT_ONLY: ConversationAccess = { read: ["project"], write: ["project"] };

// Each row is a regression the audience rule must not allow: a freelancer outside the department reading a
// request, a client reading the freelancers' space, a loser keeping access after acceptance.
const CASES: [string, Viewer, AccessFacts, ConversationAccess][] = [
  ["open, quoting: a freelancer in the department reads and writes the request", aicha, quoting, REQUEST_ONLY],
  ["open, quoting: a freelancer outside the department gets nothing", outsider, quoting, NONE],
  ["open, quoting: no department opens the request to every freelancer", outsider, { ...quoting, departmentId: null }, REQUEST_ONLY],
  ["open, quoting: a shortlist replaces the department rule", outsider, { ...quoting, shortlist: ["olu"] }, REQUEST_ONLY],
  ["open, quoting: a department freelancer off the shortlist gets nothing", ben, { ...quoting, shortlist: ["olu"] }, NONE],
  ["team, quoting: department freelancers still read and write the request", aicha, { ...quoting, quotingMode: "team" }, REQUEST_ONLY],
  ["assigned, quoting: department freelancers get nothing", aicha, { ...quoting, quotingMode: "assigned" }, NONE],
  [
    "assigned, quoting: the assigned freelancer joins the request",
    outsider,
    { ...quoting, quotingMode: "assigned", assignedFreelancerId: "olu" },
    REQUEST_ONLY,
  ],
  ["staff read and write both spaces while quoting", manager, quoting, STAFF_QUOTING],
  ["staff keep the request history after acceptance but write only the project", admin, accepted, STAFF_AFTER],
  ["the client never reads the request space", client, quoting, PROJECT_ONLY],
  ["after acceptance the winner reads and writes the project space", aicha, accepted, PROJECT_ONLY],
  ["after acceptance the other freelancers lose the request", ben, accepted, NONE],
  ["a declined request is read-only for staff", admin, { ...quoting, status: "declined" }, { read: ["request", "project"], write: [] }],
  ["a declined request is read-only for the client", client, { ...quoting, status: "declined" }, { read: ["project"], write: [] }],
  ["an expired request closes to freelancers", aicha, { ...quoting, status: "expired" }, NONE],
  ["someone with no relation gets nothing", stranger, quoting, NONE],
];

describe("conversationAccess", () => {
  for (const [label, viewer, facts, expected] of CASES) {
    it(label, () => {
      expect(conversationAccess(viewer, facts)).toEqual(expected);
    });
  }
});

describe("readableSpaces", () => {
  it("relays the request space to whoever reads the project space", () => {
    expect(readableSpaces(conversationAccess(client, quoting))).toEqual(["project", "request"]);
    expect(readableSpaces(conversationAccess(aicha, quoting))).toEqual(["request"]);
  });
});
