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

type Member = {
  userId: string;
  name: string;
  title: string | null;
};

// One input per row: its own local state so invalidating the list does not clobber what the admin is typing.
function MemberTitle({ teamSlug, member }: { teamSlug: string; member: Member }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(member.title ?? "");
  const save = useMutation(
    trpc.servicesTeam.setMemberTitle.mutationOptions({
      onSuccess: (data) => {
        setTitle(data.title ?? "");
        void queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.listMembers.queryKey({ teamSlug }) });
      },
    }),
  );
  return (
    <div className="w-full space-y-1">
      <Input
        aria-label={`Title for ${member.name}`}
        value={title}
        maxLength={80}
        placeholder="Title (for example Brand designer)"
        onChange={(e) => {
          setTitle(e.target.value);
          save.reset();
        }}
        onBlur={() => {
          const value = title.trim();
          if (value !== (member.title ?? "")) save.mutate({ teamSlug, userId: member.userId, title: value });
        }}
        className="h-8 max-w-80 text-sm"
      />
      {save.error ? (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      ) : null}
    </div>
  );
}

export default function ServicesTeamMembers({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const members = useQuery({ ...trpc.servicesTeam.listMembers.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

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
  const solo = team.data.settings?.solo ?? false;
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

      {solo ? (
        <div className="mt-6 grid gap-2 border border-dashed p-6">
          <p className="font-medium">You work alone</p>
          <p className="text-sm text-muted-foreground">
            A solo seller has no members and no payouts. Switch to a team in Settings to add people.
          </p>
          <Link href={`/${team.data.team.slug}/settings`} className="text-sm underline underline-offset-4">
            Open settings
          </Link>
        </div>
      ) : listForbidden ? (
        <p className="mt-6 text-sm text-muted-foreground">Only managers and admins can see the member list.</p>
      ) : (
        <>
          <ul className="mt-6 divide-y border">
            {(members.data ?? []).map((member) => (
              <li key={member.userId} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{member.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{member.email}</p>
                  {/* Workspace admins have no team member row, so there is no title to save. */}
                  {isAdmin && !member.workspaceAdmin ? (
                    <MemberTitle teamSlug={teamSlug} member={member} />
                  ) : member.title ? (
                    <p className="truncate text-sm text-muted-foreground">{member.title}</p>
                  ) : null}
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
