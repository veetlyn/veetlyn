// Prepares a database for the conversation and plugin walkthrough (stories AGT-10, AGT-31 to AGT-34):
// - the demo team quotes in open mode, and its listed offerings sit in one department;
// - the given accounts (signed up already) join the team as freelancers in that department;
// - another team keeps one offering and one department out of AI assistants.
// Safe to run again. Usage:
//   DATABASE_URL=... bun packages/db/scripts/demo-seed-conversations.ts --team walk-crew --department Design \
//     --freelancers tester+aicha@example.com,tester+ben@example.com --unlisted-team walk-b2-solo
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { createDb } from "../src/index";
import { user } from "../src/schema/auth";
import { memberDepartment } from "../src/schema/conversations";
import { member, team } from "../src/schema/organization";
import { servicesDepartment, servicesOffering } from "../src/schema/services-catalog";
import { servicesTeamMember, servicesTeamSettings } from "../src/schema/services-teams";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const args = z
  .object({
    DATABASE_URL: z.string().min(1, "Set DATABASE_URL to the database to prepare."),
    team: z.string().min(1),
    department: z.string().min(1),
    freelancers: z.array(z.email()).max(5),
    unlistedTeam: z.string().min(1).optional(),
  })
  .parse({
    DATABASE_URL: process.env.DATABASE_URL,
    team: argValue("--team") ?? "walk-crew",
    department: argValue("--department") ?? "Design",
    freelancers: (argValue("--freelancers") ?? "").split(",").filter(Boolean),
    unlistedTeam: argValue("--unlisted-team"),
  });

const db = createDb({ DATABASE_URL: args.DATABASE_URL });

async function teamBySlug(slug: string) {
  const [row] = await db
    .select({ id: team.id, organizationId: team.organizationId })
    .from(team)
    .where(eq(team.slug, slug))
    .limit(1);
  if (!row) throw new Error(`No team with the slug ${slug}`);
  return row;
}

async function departmentNamed(teamId: string, name: string): Promise<string> {
  const [found] = await db
    .select({ id: servicesDepartment.id })
    .from(servicesDepartment)
    .where(and(eq(servicesDepartment.teamId, teamId), sql`lower(${servicesDepartment.name}) = ${name.toLowerCase()}`))
    .limit(1);
  if (found) return found.id;
  const [created] = await db.insert(servicesDepartment).values({ teamId, name }).returning({ id: servicesDepartment.id });
  if (!created) throw new Error("Insert into services_department returned no row");
  return created.id;
}

try {
  const demo = await teamBySlug(args.team);
  await db.update(servicesTeamSettings).set({ quotingMode: "open" }).where(eq(servicesTeamSettings.teamId, demo.id));
  const departmentId = await departmentNamed(demo.id, args.department);
  const moved = await db
    .update(servicesOffering)
    .set({ departmentId, listed: true })
    .where(and(eq(servicesOffering.teamId, demo.id), isNull(servicesOffering.departmentId)))
    .returning({ name: servicesOffering.name });
  console.log(`${args.team}: open mode; ${moved.length} offering(s) moved into ${args.department}`);

  const accounts =
    args.freelancers.length === 0
      ? []
      : await db.select({ id: user.id, email: user.email }).from(user).where(inArray(user.email, args.freelancers));
  for (const email of args.freelancers) {
    const account = accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
    if (!account) {
      console.log(`- ${email}: no account yet; sign it up first`);
      continue;
    }
    const [inWorkspace] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, demo.organizationId), eq(member.userId, account.id)))
      .limit(1);
    if (!inWorkspace) {
      await db
        .insert(member)
        .values({ id: crypto.randomUUID(), organizationId: demo.organizationId, userId: account.id, role: "member", createdAt: new Date() });
    }
    const [already] = await db
      .select({ id: servicesTeamMember.id })
      .from(servicesTeamMember)
      .where(and(eq(servicesTeamMember.teamId, demo.id), eq(servicesTeamMember.userId, account.id)))
      .limit(1);
    if (!already) {
      await db
        .insert(servicesTeamMember)
        .values({ id: crypto.randomUUID(), teamId: demo.id, userId: account.id, role: "freelancer", createdAt: new Date() });
    }
    await db.insert(memberDepartment).values({ teamId: demo.id, userId: account.id, departmentId }).onConflictDoNothing();
    console.log(`- ${email}: freelancer in ${args.department}`);
  }

  if (args.unlistedTeam) {
    const other = await teamBySlug(args.unlistedTeam);
    const [offering] = await db
      .select({ id: servicesOffering.id, name: servicesOffering.name })
      .from(servicesOffering)
      .where(and(eq(servicesOffering.teamId, other.id), eq(servicesOffering.active, true)))
      .limit(1);
    if (offering) {
      await db.update(servicesOffering).set({ listed: false }).where(eq(servicesOffering.id, offering.id));
      console.log(`${args.unlistedTeam}: "${offering.name}" is not listed in AI assistants`);
    }
    const hiddenId = await departmentNamed(other.id, "Not in AI assistants");
    await db.update(servicesDepartment).set({ listed: false }).where(eq(servicesDepartment.id, hiddenId));
    console.log(`${args.unlistedTeam}: the department "Not in AI assistants" is unlisted`);
  }
} finally {
  await db.$client.end();
}
