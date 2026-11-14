"use client";

import { isServicesTeamRole, SERVICES_TEAM_ROLES, type ServicesTeamRole } from "@jendal-workspace/core";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/motion/checkbox";
import { Drawer } from "@jendal-workspace/ui/components/motion/drawer";
import { Input } from "@jendal-workspace/ui/components/motion/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@jendal-workspace/ui/components/motion/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { initialsOf } from "@/components/app-frame";
import { DataList } from "@/components/data-list";
import Loader from "@/components/loader";
import { ListPage, PageHeader } from "@/components/page-composition";
import { PlatformName } from "@/components/platform-name";
import TeamNotFound from "@/components/services-team/team-not-found";
import { SettingsSection } from "@/components/settings-section";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { trpc } from "@/utils/trpc";
import MemberAccessEditor from "./member-access";

type Member = {
  userId: string;
  name: string;
  email: string;
  title: string | null;
  role: ServicesTeamRole;
  workspaceAdmin?: boolean;
};

function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  return (
    <span aria-hidden="true" className={size === "lg"
      ? "grid size-11 shrink-0 place-items-center rounded-full bg-foreground/[0.06] text-[14px] font-medium"
      : "grid size-8 shrink-0 place-items-center rounded-full bg-foreground/[0.06] text-[12px] font-medium"}>
      {initialsOf(name)}
    </span>
  );
}

function RoleSelect({ value, onChange, disabled, label, className }: { value: ServicesTeamRole; onChange: (role: ServicesTeamRole) => void; disabled?: boolean; label: string; className?: string }) {
  return (
    <Select value={value} onValueChange={(next) => { if (isServicesTeamRole(next)) onChange(next); }} disabled={disabled} className={className}>
      <SelectTrigger aria-label={label} className="h-9 text-[14px]"><SelectValue /></SelectTrigger>
      <SelectContent>{SERVICES_TEAM_ROLES.map((role) => <SelectItem key={role} value={role}>{SERVICES_TEAM_ROLE_LABELS[role]}</SelectItem>)}</SelectContent>
    </Select>
  );
}

// A part of the member drawer: a small heading, then its controls.
function DrawerPart({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 px-6 py-5">
      <h3 className="text-[13px] font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

// Everything an admin sets for one person, in one drawer: role, title, the requests they answer and what they see.
function MemberDrawer({ teamSlug, member, departments, chosen, onClose }: {
  teamSlug: string;
  member: Member;
  departments: { id: string; name: string }[];
  chosen: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(member.title ?? "");
  const invalidateMembers = () => queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.listMembers.queryKey({ teamSlug }) });
  const setRole = useMutation(trpc.servicesTeam.setMemberRole.mutationOptions({ onSuccess: () => { toast.success("Role updated"); return invalidateMembers(); } }));
  const saveTitle = useMutation(trpc.servicesTeam.setMemberTitle.mutationOptions({
    onSuccess: (data) => { setTitle(data.title ?? ""); toast.success("Title saved"); return invalidateMembers(); },
  }));
  const saveDepartments = useMutation(trpc.servicesTeam.setMemberDepartments.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.listMemberDepartments.queryKey({ teamSlug }) }),
  }));
  const error = setRole.error ?? saveTitle.error ?? saveDepartments.error;

  return (
    <>
      <header className="flex items-center gap-3 border-b px-6 py-5">
        <Avatar name={member.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-medium">{member.name}</h2>
          <p className="truncate text-[13px] text-muted-foreground">{member.email}</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}><X aria-hidden="true" /></Button>
      </header>
      <div data-scroll className="min-h-0 flex-1 divide-y overflow-y-auto">
        <DrawerPart title="Role">
          <RoleSelect
            label={`Role for ${member.name}`}
            value={member.role}
            disabled={setRole.isPending}
            onChange={(role) => setRole.mutate({ teamSlug, userId: member.userId, role })}
            className="z-30 w-full"
          />
        </DrawerPart>
        <DrawerPart title="Title">
          <Input
            aria-label={`Title for ${member.name}`}
            value={title}
            maxLength={80}
            placeholder="For example Brand designer"
            onChange={(next) => { setTitle(next); saveTitle.reset(); }}
            onBlur={() => {
              const value = title.trim();
              if (value !== (member.title ?? "")) saveTitle.mutate({ teamSlug, userId: member.userId, title: value });
            }}
            classNames={{ field: "h-9 rounded-lg bg-card", input: "text-[14px]" }}
          />
          <p className="text-[13px] text-muted-foreground">Shown next to their name. Saved when you leave the field.</p>
        </DrawerPart>
        {member.role === "freelancer" && departments.length > 0 ? (
          <DrawerPart title="Answers requests for">
            <div className="grid gap-2.5">
              {departments.map((department) => (
                <Checkbox
                  key={department.id}
                  label={department.name}
                  checked={chosen.includes(department.id)}
                  disabled={saveDepartments.isPending}
                  onCheckedChange={(on) => saveDepartments.mutate({
                    teamSlug,
                    userId: member.userId,
                    departmentIds: on ? [...chosen, department.id] : chosen.filter((id) => id !== department.id),
                  })}
                />
              ))}
            </div>
            <p className="text-[13px] text-muted-foreground">Requests for these categories reach them, plus requests without one.</p>
          </DrawerPart>
        ) : null}
        {member.role !== "admin" ? (
          <DrawerPart title="Pages they can open">
            <MemberAccessEditor teamSlug={teamSlug} userId={member.userId} />
          </DrawerPart>
        ) : null}
        {error ? <p role="alert" className="px-6 py-4 text-[13px] text-destructive">{error.message}</p> : null}
      </div>
    </>
  );
}

export default function ServicesTeamMembers({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const members = useQuery({ ...trpc.servicesTeam.listMembers.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const catalog = useQuery({ ...trpc.servicesCatalog.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const memberDepartments = useQuery({ ...trpc.servicesTeam.listMemberDepartments.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<ServicesTeamRole>("freelancer");
  const [editingId, setEditingId] = useState<string | null>(null);

  const add = useMutation(trpc.servicesTeam.addMember.mutationOptions({
    onSuccess: () => {
      setEmail("");
      toast.success("Member added");
      void queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.listMembers.queryKey({ teamSlug }) });
    },
  }));

  if (team.isPending) return <Loader />;
  if (team.isError) return <TeamNotFound />;

  const isAdmin = team.data.role === "admin";
  const departments = catalog.data?.departments ?? [];
  const solo = team.data.settings?.solo ?? false;
  // Managers see the list; only admins change it. Freelancers get a FORBIDDEN from listMembers.
  const listForbidden = members.error?.data?.code === "FORBIDDEN";
  const allMembers: Member[] = members.data ?? [];
  const departmentsFor = (userId: string) => (memberDepartments.data ?? []).filter((row) => row.userId === userId).map((row) => row.departmentId);
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));
  const editing = allMembers.find((m) => m.userId === editingId) ?? null;

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email.trim()) add.mutate({ teamSlug, email: email.trim(), role: newRole });
  }

  const header = <PageHeader title="Team & access" description="The people you work with, their roles, and what each of them can see." />;

  if (solo) {
    return (
      <ListPage>
        {header}
        <SettingsSection
          title="You work alone"
          description="A solo seller has no members and no payouts."
          footer={<><span>Switch to a team to add people.</span><Button render={<Link href={`/${team.data.team.slug}/settings`} />} variant="outline" size="sm">Open General</Button></>}
        >
          <p className="px-6 py-5 text-[14px] text-muted-foreground">When you switch, you can invite members, give them roles and split prices with them.</p>
        </SettingsSection>
      </ListPage>
    );
  }

  return (
    <ListPage>
      {header}
      {listForbidden ? (
        <p className="text-[14px] text-muted-foreground">Only managers and admins can see the member list.</p>
      ) : members.isPending ? <Loader /> : members.isError ? (
        <p role="alert" className="text-[14px] text-destructive">{members.error.message}</p>
      ) : (
        <>
          {isAdmin ? (
            <form onSubmit={handleAdd}>
              <SettingsSection title="Invite someone" description={<>They need a <PlatformName /> account already; ask them to sign up first.</>}>
                <div className="flex flex-wrap items-center gap-3 px-6 py-5">
                  <Input
                    id="member-email"
                    type="email"
                    aria-label="Email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(next) => { setEmail(next); add.reset(); }}
                    required
                    className="min-w-0 flex-1 basis-64"
                    classNames={{ field: "h-9 rounded-lg bg-card", input: "text-[14px]" }}
                  />
                  <RoleSelect label="Role" value={newRole} onChange={setNewRole} className="z-30 w-40" />
                  <Button type="submit" disabled={!email.trim() || add.isPending}>{add.isPending ? "Adding…" : "Add member"}</Button>
                  {add.error ? <p role="alert" className="basis-full text-[13px] text-destructive">{add.error.message}</p> : null}
                </div>
              </SettingsSection>
            </form>
          ) : null}

          <DataList<Member>
            label="Members"
            rows={allMembers}
            getRowId={(m) => m.userId}
            searchText={(m) => `${m.name} ${m.email} ${m.title ?? ""}`}
            searchLabel="Search people"
            views={[
              { key: "all", label: "Everyone" },
              ...SERVICES_TEAM_ROLES.map((role) => ({ key: role, label: `${SERVICES_TEAM_ROLE_LABELS[role]}s`, match: (m: Member) => m.role === role })),
            ]}
            filters={departments.length > 0 ? [{
              key: "department",
              label: "Category",
              options: departments.map((d) => ({ value: d.id, label: d.name })),
              match: (m, value) => departmentsFor(m.userId).includes(value),
            }] : []}
            defaultSort={{ key: "name", direction: "asc" }}
            noun={{ one: "person", many: "people" }}
            empty={{ title: "No members yet", text: "Invite the people you work with." }}
            titleKey="name"
            columns={[
              {
                key: "name",
                header: "Member",
                sortable: true,
                sortValue: (m) => m.name.toLocaleLowerCase(),
                cell: (m) => (
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={m.name} />
                    <span className="grid min-w-0">
                      <span className="truncate font-medium">{m.name}</span>
                      <span className="truncate text-[12px] text-muted-foreground">{m.email}</span>
                    </span>
                  </span>
                ),
              },
              { key: "title", header: "Title", width: "180px", cell: (m) => m.title ? <span className="truncate">{m.title}</span> : <span className="text-muted-foreground">—</span> },
              {
                key: "categories",
                header: "Answers",
                width: "180px",
                cell: (m) => {
                  if (m.role !== "freelancer") return <span className="text-muted-foreground">—</span>;
                  const names = departmentsFor(m.userId).map((id) => departmentName.get(id)).filter(Boolean);
                  return <span className="truncate">{names.length > 0 ? names.join(", ") : "All requests"}</span>;
                },
              },
              {
                key: "role",
                header: "Role",
                width: "160px",
                sortable: true,
                sortValue: (m) => SERVICES_TEAM_ROLE_LABELS[m.role],
                cell: (m) => <Badge tone="neutral">{m.workspaceAdmin ? "Admin · workspace" : SERVICES_TEAM_ROLE_LABELS[m.role]}</Badge>,
              },
              ...(isAdmin ? [{
                key: "action",
                header: <span className="sr-only">Actions</span>,
                width: "96px",
                align: "right" as const,
                cell: (m: Member) => m.workspaceAdmin ? null : <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(m.userId)} aria-label={`Edit ${m.name}`}>Edit</Button>,
              }] : []),
            ]}
          />

          <Drawer open={editing !== null} onOpenChange={(open) => { if (!open) setEditingId(null); }} ariaLabel={editing ? `Edit ${editing.name}` : "Edit member"} className="w-[440px] bg-card">
            {editing ? (
              <MemberDrawer
                key={editing.userId}
                teamSlug={teamSlug}
                member={editing}
                departments={departments}
                chosen={departmentsFor(editing.userId)}
                onClose={() => setEditingId(null)}
              />
            ) : null}
          </Drawer>
        </>
      )}
    </ListPage>
  );
}
