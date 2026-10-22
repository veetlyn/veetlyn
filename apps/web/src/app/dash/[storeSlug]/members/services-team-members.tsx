"use client";

import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { isServicesTeamRole, SERVICES_TEAM_ROLES, type ServicesTeamRole } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import Loader from "@/components/loader";
import { PlatformName } from "@/components/platform-name";
import TeamNotFound from "@/components/services-team/team-not-found";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { trpc } from "@/utils/trpc";

const SELECT_CLASS = `${nativeSelectClass}`;

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

// Which requests reach a freelancer: those for offerings in their departments, plus requests with none.
function MemberDepartments({
  teamSlug,
  member,
  departments,
  chosen,
}: {
  teamSlug: string;
  member: Member;
  departments: { id: string; name: string }[];
  chosen: string[];
}) {
  const queryClient = useQueryClient();
  const save = useMutation(
    trpc.servicesTeam.setMemberDepartments.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.listMemberDepartments.queryKey({ teamSlug }) }),
    }),
  );
  const toggle = (departmentId: string, on: boolean) => {
    const next = on ? [...chosen, departmentId] : chosen.filter((id) => id !== departmentId);
    save.mutate({ teamSlug, userId: member.userId, departmentIds: next });
  };
  return (
    <fieldset className="mt-2 grid gap-1">
      <legend className="text-sm text-muted-foreground">Answers requests for</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {departments.map((department) => (
          <label key={department.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={chosen.includes(department.id)}
              disabled={save.isPending}
              onCheckedChange={(checked) => toggle(department.id, checked === true)}
            />
            {department.name}
          </label>
        ))}
      </div>
      {save.error ? (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      ) : null}
    </fieldset>
  );
}

export default function ServicesTeamMembers({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const members = useQuery({ ...trpc.servicesTeam.listMembers.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const catalog = useQuery({ ...trpc.servicesCatalog.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const memberDepartments = useQuery({
    ...trpc.servicesTeam.listMemberDepartments.queryOptions({ teamSlug }),
    retry: false,
    meta: { silent: true },
  });

  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<ServicesTeamRole>("freelancer");

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
  const departments = catalog.data?.departments ?? [];
  const solo = team.data.settings?.solo ?? false;
  // Managers see the list; only admins change it. Freelancers get a FORBIDDEN from listMembers.
  const listForbidden = members.error?.data?.code === "FORBIDDEN";

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email.trim()) add.mutate({ teamSlug, email: email.trim(), role: newRole });
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 [&>*]:max-w-3xl md:px-7 md:py-8">
      <h1 className="font-heading text-3xl">Members</h1>

      {solo ? (
        <div className="panel mt-6 grid gap-2 p-6">
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
      ) : members.isError ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {members.error.message}
        </p>
      ) : (
        <>
          <ul className="mt-6 panel divide-y overflow-hidden">
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
                  {isAdmin && member.role === "freelancer" && departments.length > 0 ? (
                    <MemberDepartments
                      teamSlug={teamSlug}
                      member={member}
                      departments={departments}
                      chosen={(memberDepartments.data ?? [])
                        .filter((row) => row.userId === member.userId)
                        .map((row) => row.departmentId)}
                    />
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
                    onChange={(e) => {
                      const role = e.target.value;
                      if (isServicesTeamRole(role)) setRole.mutate({ teamSlug, userId: member.userId, role });
                    }}
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
                They need a <PlatformName /> account already; ask them to sign up first.
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
                    onChange={(e) => {
                      if (isServicesTeamRole(e.target.value)) setNewRole(e.target.value);
                    }}
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
