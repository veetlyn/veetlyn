"use client";

import { MAX_DEPARTMENT_NAME } from "@jendal-workspace/core";
import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Input } from "@jendal-workspace/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import Loader from "@/components/loader";
import TeamNotFound from "@/components/services-team/team-not-found";
import { daysLabel, priceLabel } from "@/lib/offering-labels";
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
    <li className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
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
          className="max-w-60"
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
          variant="outline"
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
      {rename.error ?? setListed.error ? (
        <p role="alert" className="text-sm text-destructive">
          {(rename.error ?? setListed.error)?.message}
        </p>
      ) : null}
    </li>
  );
}

export default function ServicesCatalog({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const catalog = useQuery({ ...trpc.servicesCatalog.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  const [departmentName, setDepartmentName] = useState("");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.servicesCatalog.list.queryKey({ teamSlug }) });
    void queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) });
  };
  const addDepartment = useMutation(
    trpc.servicesCatalog.createDepartment.mutationOptions({
      onSuccess: () => {
        setDepartmentName("");
        invalidate();
      },
    }),
  );
  const setOfferingActive = useMutation(
    trpc.servicesCatalog.setOfferingActive.mutationOptions({ onSuccess: invalidate }),
  );
  const deleteOffering = useMutation(trpc.servicesCatalog.deleteOffering.mutationOptions({ onSuccess: invalidate }));

  if (team.isPending || catalog.isPending) return <Loader />;
  if (team.isError) return <TeamNotFound />;

  const isAdmin = team.data.role === "admin";
  const currency = team.data.settings?.currency ?? "USD";
  const departments = catalog.data?.departments ?? [];
  const offerings = catalog.data?.offerings ?? [];

  const byDepartment = new Map<string, typeof offerings>();
  for (const offering of offerings) {
    const key = offering.departmentId ?? "";
    byDepartment.set(key, [...(byDepartment.get(key) ?? []), offering]);
  }
  const ungrouped = byDepartment.get("") ?? [];

  function handleAddDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (departmentName.trim()) addDepartment.mutate({ teamSlug, name: departmentName.trim() });
  }

  function renderOffering(offering: (typeof offerings)[number]) {
    const questionCount = offering.intakeQuestions.length;
    return (
      <li key={offering.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
        <Link href={`/${teamSlug}/services/${offering.id}`} className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-medium">
            <span className="truncate">{offering.name}</span>
            {!offering.active ? <Badge>Hidden</Badge> : null}
            {offering.active && !offering.listed ? <Badge>Not in AI assistants</Badge> : null}
          </p>
          <p className="text-sm text-muted-foreground">
            {priceLabel(offering, currency)} · {daysLabel(offering)}
            {questionCount > 0 ? ` · ${questionCount} ${questionCount === 1 ? "question" : "questions"}` : ""}
          </p>
        </Link>
        {isAdmin ? (
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={setOfferingActive.isPending}
              onClick={() =>
                setOfferingActive.mutate({ teamSlug, offeringId: offering.id, active: !offering.active })
              }
            >
              {offering.active ? "Hide" : "Show"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={deleteOffering.isPending}
              onClick={() => {
                if (window.confirm("Delete this service? Projects that used it keep their records.")) {
                  deleteOffering.mutate({ teamSlug, offeringId: offering.id });
                }
              }}
            >
              Delete
            </Button>
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-3xl">Services</h1>
        </div>
        {isAdmin ? (
          <Link href={`/${teamSlug}/services/new`} className={buttonVariants()}>
            Add service
          </Link>
        ) : null}
      </div>

      {catalog.isError && (
        <p role="alert" className="text-sm text-destructive">
          The services couldn't be loaded.
        </p>
      )}

      {!catalog.isError && offerings.length === 0 && (
        <section className="panel grid justify-items-center gap-2 p-10 text-center">
          <p className="font-heading text-lg">No services yet</p>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? (
              <Link href={`/${teamSlug}/services/new`} className="underline underline-offset-4">
                Add your first service — what you make, what it usually costs and how long it takes.
              </Link>
            ) : (
              "An admin adds the services: what the team makes, what it usually costs and how long it takes."
            )}
          </p>
        </section>
      )}

      {!catalog.isError && (isAdmin || departments.length > 0) && (
        <section className="panel space-y-3 p-5">
          <h2 className="font-medium">Departments</h2>
          <p className="text-sm text-muted-foreground">
            Optional groups for your seller page. A service can also stand alone.
          </p>
          {isAdmin ? (
            <>
              <form onSubmit={handleAddDepartment} className="flex items-center gap-2">
                <Input
                  aria-label="New department name"
                  value={departmentName}
                  maxLength={MAX_DEPARTMENT_NAME}
                  placeholder="New department"
                  onChange={(e) => {
                    setDepartmentName(e.target.value);
                    addDepartment.reset();
                  }}
                />
                <Button type="submit" disabled={!departmentName.trim() || addDepartment.isPending}>
                  {addDepartment.isPending ? "Adding…" : "Add department"}
                </Button>
              </form>
              {addDepartment.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {addDepartment.error.message}
                </p>
              ) : null}
            </>
          ) : null}
          {departments.length > 0 &&
            (isAdmin ? (
              <ul className="space-y-3">
                {departments.map((department) => (
                  <DepartmentRow
                    key={department.id}
                    teamSlug={teamSlug}
                    department={department}
                    offeringCount={(byDepartment.get(department.id) ?? []).length}
                  />
                ))}
              </ul>
            ) : (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {departments.map((department) => (
                  <li key={department.id}>{department.name}</li>
                ))}
              </ul>
            ))}
        </section>
      )}

      {offerings.length > 0 && (
        <div className="space-y-6">
          {departments
            .filter((department) => (byDepartment.get(department.id) ?? []).length > 0)
            .map((department) => (
              <section key={department.id} className="space-y-2">
                <h2 className="text-sm font-medium text-muted-foreground">{department.name}</h2>
                <ul className="panel divide-y overflow-hidden">
                  {(byDepartment.get(department.id) ?? []).map((offering) => renderOffering(offering))}
                </ul>
              </section>
            ))}
          {ungrouped.length > 0 && (
            <section className="space-y-2">
              {departments.length > 0 && <h2 className="text-sm font-medium text-muted-foreground">Not in a department</h2>}
              <ul className="panel divide-y overflow-hidden">{ungrouped.map((offering) => renderOffering(offering))}</ul>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
