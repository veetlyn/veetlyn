"use client";

import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { isServicesTeamRole, SERVICES_TEAM_ROLES, type ServicesTeamRole } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pagination } from "@jendal-workspace/ui/components/motion/pagination";
import Link from "next/link";
import { Search } from "lucide-react";
import { type FormEvent, useState } from "react";

import Loader from "@/components/loader";
import { WorkPage } from "@/components/page-composition";
import { PlatformName } from "@/components/platform-name";
import TeamNotFound from "@/components/services-team/team-not-found";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { type ListSort, listView } from "@/lib/list-view";
import { trpc } from "@/utils/trpc";
import MemberAccessEditor from "./member-access";

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

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [sort, setSort] = useState<ListSort>({ key: "name", direction: "asc" });
  const [page, setPage] = useState(1);
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
  const allMembers = members.data ?? [];
  const departmentsFor = (userId: string) => (memberDepartments.data ?? []).filter((row) => row.userId === userId).map((row) => row.departmentId);
  const view = listView(allMembers, {
    query,
    searchText: (member) => `${member.name} ${member.email} ${member.title ?? ""}`,
    filterValues: { role: roleFilter, department: departmentFilter },
    filters: {
      role: (member, value) => member.role === value,
      department: (member, value) => departmentsFor(member.userId).includes(value),
    },
    sort,
    sortValues: {
      name: (member) => member.name.toLocaleLowerCase(),
      role: (member) => SERVICES_TEAM_ROLE_LABELS[member.role] ?? member.role,
    },
    page,
    pageSize: 20,
  });

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email.trim()) add.mutate({ teamSlug, email: email.trim(), role: newRole });
  }

  return (
    <WorkPage>
      <h1 className="font-heading text-3xl">Team & access</h1>
      <p className="mt-2 text-sm text-muted-foreground">The people you work with and what they can see and do.</p>
      {setRole.error ? <p role="alert" className="mt-4 text-sm text-destructive">{setRole.error.message}</p> : null}
      {setRole.isSuccess ? <p role="status" className="mt-4 text-sm text-brand-text">Role updated.</p> : null}

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
      ) : members.isPending ? <Loader /> : members.isError ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {members.error.message}
        </p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <label className="relative w-full sm:w-72">
              <span className="sr-only">Search people by name, email or title</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search people…" className="pl-9" />
            </label>
            <label>
              <span className="sr-only">Role</span>
              <select className={`${SELECT_CLASS} h-10 min-w-36`} value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(1); }}>
                <option value="all">All roles</option>
                {SERVICES_TEAM_ROLES.map((role) => <option key={role} value={role}>{SERVICES_TEAM_ROLE_LABELS[role]}</option>)}
              </select>
            </label>
            {departments.length > 0 ? (
              <label>
                <span className="sr-only">Category</span>
                <select className={`${SELECT_CLASS} h-10 min-w-40`} value={departmentFilter} onChange={(event) => { setDepartmentFilter(event.target.value); setPage(1); }}>
                  <option value="all">All categories</option>
                  {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
              </label>
            ) : null}
            <label>
              <span className="sr-only">Sort people</span>
              <select
                className={`${SELECT_CLASS} h-10 min-w-36`}
                value={`${sort?.key}-${sort?.direction}`}
                onChange={(event) => {
                  const [key, direction] = event.target.value.split("-");
                  if ((key === "name" || key === "role") && (direction === "asc" || direction === "desc")) setSort({ key, direction });
                  setPage(1);
                }}
              >
                <option value="name-asc">Name A–Z</option>
                <option value="name-desc">Name Z–A</option>
                <option value="role-asc">Role A–Z</option>
              </select>
            </label>
            <p role="status" className="ml-auto text-sm text-muted-foreground tabular-nums">{view.total} {view.total === 1 ? "person" : "people"}</p>
          </div>
          {view.total === 0 ? (
            <div className="rounded-[10px] border px-5 py-10 text-center">
              <h2 className="font-heading text-lg">No matching people</h2>
              <p className="mt-2 text-sm text-muted-foreground">Try another name, email, role or category.</p>
              <Button type="button" variant="outline" className="mt-4" onClick={() => { setQuery(""); setRoleFilter("all"); setDepartmentFilter("all"); setPage(1); }}>Clear filters</Button>
            </div>
          ) : (
          <ul className="panel divide-y overflow-hidden">
            {view.rows.map((member) => (
              <li key={member.userId} className="flex flex-wrap items-start justify-between gap-4 px-4 py-5 sm:flex-nowrap">
                <div className="min-w-0 flex-1 basis-52">
                  <p className="truncate font-medium">{member.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{member.email}</p>
                  {isAdmin && member.role !== "admin" ? <MemberAccessEditor teamSlug={teamSlug} userId={member.userId} name={member.name} /> : null}
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
                      chosen={departmentsFor(member.userId)}
                    />
                  ) : null}
                </div>
                {member.workspaceAdmin ? (
                  <span className="shrink-0 text-sm text-muted-foreground" title="Set by the workspace">
                    Admin — workspace
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
          )}
          {view.totalPages > 1 ? <div className="flex justify-center"><Pagination totalPages={view.totalPages} page={view.page} onPageChange={setPage} aria-label="People pages" /></div> : null}

          {isAdmin ? (
            <form onSubmit={handleAdd} className="mt-8 grid gap-4">
              <h2 className="font-medium">Add a member</h2>
              <p className="text-sm text-muted-foreground">
                They need a <PlatformName /> account already; ask them to sign up first.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 basis-60 grow space-y-2">
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
              {add.isSuccess ? <p role="status" className="text-sm text-brand-text">Member added.</p> : null}
            </form>
          ) : null}
        </>
      )}
    </WorkPage>
  );
}
