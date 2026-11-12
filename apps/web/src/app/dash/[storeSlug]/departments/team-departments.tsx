"use client";

import { MAX_DEPARTMENT_NAME } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import Loader from "@/components/loader";
import { WorkPage } from "@/components/page-composition";
import { RecordCard } from "@/components/record-card";
import TeamNotFound from "@/components/services-team/team-not-found";
import { trpc } from "@/utils/trpc";

// One input per row: its own local state so invalidating the list does not clobber what the admin is typing.
function DepartmentRow({
  teamSlug,
  department,
  offeringCount,
}: {
  teamSlug: string;
  department: { id: string; name: string; listed: boolean };
  offeringCount: number;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(department.name);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.servicesCatalog.list.queryKey({ teamSlug }) });
    void queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) });
  };
  const rename = useMutation(
    trpc.servicesCatalog.renameDepartment.mutationOptions({
      onSuccess: (data) => {
        setName(data.name);
        invalidate();
      },
    }),
  );
  const remove = useMutation(trpc.servicesCatalog.deleteDepartment.mutationOptions({ onSuccess: invalidate }));
  const setListed = useMutation(trpc.servicesCatalog.setDepartmentListed.mutationOptions({ onSuccess: invalidate }));
  return (
    <li className="grid gap-1 px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label={`Rename ${department.name}`}
          value={name}
          maxLength={MAX_DEPARTMENT_NAME}
          onChange={(e) => {
            setName(e.target.value);
            rename.reset();
          }}
          onBlur={() => {
            const value = name.trim();
            if (value !== department.name) rename.mutate({ teamSlug, departmentId: department.id, name: value });
          }}
          className="w-60 max-w-full"
        />
        <span className="text-sm text-muted-foreground">
          {offeringCount} {offeringCount === 1 ? "service" : "services"}
        </span>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={department.listed}
            disabled={setListed.isPending}
            onCheckedChange={(checked) =>
              setListed.mutate({ teamSlug, departmentId: department.id, listed: checked === true })
            }
          />
          List in AI assistants
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm("Delete this department? Its services stay, ungrouped.")) {
              remove.mutate({ teamSlug, departmentId: department.id });
            }
          }}
        >
          Delete
        </Button>
      </div>
      {rename.error ?? setListed.error ?? remove.error ? (
        <p role="alert" className="text-sm text-destructive">
          {(rename.error ?? setListed.error ?? remove.error)?.message}
        </p>
      ) : null}
    </li>
  );
}

// The catalog's departments: the groups clients browse on the seller page and AI assistants list.
export default function TeamDepartments({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const catalog = useQuery({ ...trpc.servicesCatalog.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const [name, setName] = useState("");
  const add = useMutation(
    trpc.servicesCatalog.createDepartment.mutationOptions({
      onSuccess: () => {
        setName("");
        void queryClient.invalidateQueries({ queryKey: trpc.servicesCatalog.list.queryKey({ teamSlug }) });
        void queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) });
      },
    }),
  );
  if (team.isPending || catalog.isPending) return <Loader />;
  if (team.isError) return <TeamNotFound />;
  const isAdmin = team.data.role === "admin";
  const departments = catalog.data?.departments ?? [];
  const offerings = catalog.data?.offerings ?? [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim()) add.mutate({ teamSlug, name: name.trim() });
  }

  return (
    <WorkPage>
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">Departments</h1>
        <p className="text-sm text-muted-foreground">Optional groups for your services on the seller page. A service can also stand alone.</p>
      </div>
      <RecordCard
        title="Departments"
        description={`${departments.length} ${departments.length === 1 ? "department" : "departments"}`}
        flush={departments.length > 0}
        footer={isAdmin ? (
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="new-department">New department</Label>
              <Input id="new-department" value={name} maxLength={MAX_DEPARTMENT_NAME} className="w-72 max-w-full" onChange={(e) => { setName(e.target.value); add.reset(); }} />
            </div>
            <Button type="submit" variant="outline" disabled={!name.trim() || add.isPending}>{add.isPending ? "Adding…" : "Add department"}</Button>
            {add.error ? <p role="alert" className="basis-full text-sm text-destructive">{add.error.message}</p> : null}
          </form>
        ) : undefined}
      >
        {departments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No departments yet.</p>
        ) : isAdmin ? (
          <ul className="divide-y">
            {departments.map((department) => (
              <DepartmentRow key={department.id} teamSlug={teamSlug} department={department} offeringCount={offerings.filter((o) => o.departmentId === department.id).length} />
            ))}
          </ul>
        ) : (
          <ul className="divide-y">
            {departments.map((department) => (
              <li key={department.id} className="flex justify-between gap-4 px-5 py-3.5 text-sm">
                <span>{department.name}</span>
                <span className="text-muted-foreground">{offerings.filter((o) => o.departmentId === department.id).length} services</span>
              </li>
            ))}
          </ul>
        )}
      </RecordCard>
    </WorkPage>
  );
}
