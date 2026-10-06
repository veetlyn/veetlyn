"use client";

import { SERVICES_TEAM_ROLES } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import Loader from "@/components/loader";
import TeamNotFound from "@/components/services-team/team-not-found";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { trpc } from "@/utils/trpc";

const SELECT_CLASS = "h-9 rounded-md border bg-transparent px-2 text-sm";

export default function ServicesTeamMembers({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false });
  const members = useQuery({ ...trpc.servicesTeam.listMembers.queryOptions({ teamSlug }), retry: false });

  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<string>("freelancer");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.listMembers.queryKey({ teamSlug }) });

  const add = useMutation(
    trpc.servicesTeam.addMember.mutationOptions({
      onSuccess: () => {
        setEmail("");
        void invalidate();
      },
    }),
  );
  const setRole = useMutation(trpc.servicesTeam.setMemberRole.mutationOptions({ onSuccess: invalidate }));

  if (team.isPending) return <Loader />;
  if (team.isError) return <TeamNotFound />;

  const isAdmin = team.data.role === "admin";
  // Managers see the list; only admins change it. Freelancers get a FORBIDDEN from listMembers.
  const listForbidden = members.isError;

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email.trim()) add.mutate({ teamSlug, email: email.trim(), role: newRole as "admin" | "manager" | "freelancer" });
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 py-10">
      <Link href={`/${team.data.team.slug}`} className="text-sm text-muted-foreground">
        {team.data.team.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Members</h1>

      {listForbidden ? (
        <p className="mt-6 text-sm text-muted-foreground">Only managers and admins can see the member list.</p>
      ) : (
        <>
          <ul className="mt-6 divide-y border">
            {(members.data ?? []).map((member) => (
              <li key={member.userId} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{member.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{member.email}</p>
                </div>
                {member.workspaceAdmin ? (
                  <span className="shrink-0 text-sm text-muted-foreground" title="Set by the workspace">
                    Admin · workspace
                  </span>
                ) : isAdmin ? (
                  <select
                    aria-label={`Role for ${member.name}`}
                    className={SELECT_CLASS}
                    value={member.role}
                    disabled={setRole.isPending}
                    onChange={(e) =>
                      setRole.mutate({
                        teamSlug,
                        userId: member.userId,
                        role: e.target.value as "admin" | "manager" | "freelancer",
                      })
                    }
                  >
                    {SERVICES_TEAM_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {SERVICES_TEAM_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {SERVICES_TEAM_ROLE_LABELS[member.role] ?? member.role}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {isAdmin ? (
            <form onSubmit={handleAdd} className="mt-8 grid gap-4">
              <h2 className="font-medium">Add a member</h2>
              <p className="text-sm text-muted-foreground">
                They need a Payleor account already; ask them to sign up first.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-60 grow space-y-2">
                  <Label htmlFor="member-email">Email</Label>
                  <Input
                    id="member-email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      add.reset();
                    }}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="member-role">Role</Label>
                  <select
                    id="member-role"
                    className={SELECT_CLASS}
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                  >
                    {SERVICES_TEAM_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {SERVICES_TEAM_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" disabled={!email.trim() || add.isPending}>
                  {add.isPending ? "Adding…" : "Add member"}
                </Button>
              </div>
              {add.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {add.error.message}
                </p>
              ) : null}
            </form>
          ) : null}
        </>
      )}
    </main>
  );
}
