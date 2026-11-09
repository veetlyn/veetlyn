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
import { daysLabel, FULFILMENT_LABELS, priceLabel } from "@/lib/offering-labels";
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
      {rename.error ?? setListed.error ?? remove.error ? (
        <p role="alert" className="text-sm text-destructive">
          {(rename.error ?? setListed.error ?? remove.error)?.message}
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
  const [search, setSearch] = useState("");

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
  const matching = offerings.filter((offering) => `${offering.name} ${offering.description}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  const byDepartment = new Map<string, typeof offerings>();
  for (const offering of matching) {
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
        <Link href={`/${teamSlug}/services/${offering.id}`} className="min-w-0 flex-1 basis-full sm:basis-auto">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate">{offering.name}</span>
            {!offering.active ? <Badge>Hidden</Badge> : null}
            {offering.active && !offering.listed ? <Badge>Not in AI assistants</Badge> : null}
          </p>
          <p className="text-sm text-muted-foreground">
            {priceLabel(offering, currency)} — {daysLabel(offering)} — {FULFILMENT_LABELS[offering.fulfilment]}
            {questionCount > 0 ? ` — ${questionCount} ${questionCount === 1 ? "question" : "questions"}` : ""}
          </p>
        </Link>
        {isAdmin ? (
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={setOfferingActive.isPending || deleteOffering.isPending}
              onClick={() =>
                setOfferingActive.mutate({ teamSlug, offeringId: offering.id, active: !offering.active })
              }
            >
              {offering.active ? "Hide" : "Show"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={deleteOffering.isPending || setOfferingActive.isPending}
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1 basis-full space-y-1 sm:basis-auto">
          <h1 className="font-heading text-3xl">Services</h1>
          <p className="text-sm text-muted-foreground">What clients can request from your seller page.</p>
        </div>
        {isAdmin ? (
          <Link href={`/${teamSlug}/services/new`} className={buttonVariants()}>
            Add service
          </Link>
        ) : null}
      </div>

      {catalog.isError && (
        <div role="alert" className="space-y-3 rounded-[10px] border p-5 text-sm">
          <p>The services couldn’t be loaded.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void catalog.refetch()}>Try again</Button>
        </div>
      )}
      {setOfferingActive.error ?? deleteOffering.error ? <p role="alert" className="text-sm text-destructive">{(setOfferingActive.error ?? deleteOffering.error)?.message}</p> : null}
      {!catalog.isError && offerings.length > 0 ? (
        <label className="block w-full sm:max-w-72"><span className="sr-only">Search services</span><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search services…" /></label>
      ) : null}

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
        <details className="rounded-[10px] border p-4">
          <summary className="cursor-pointer text-sm font-medium">{isAdmin ? "Manage departments" : "Departments"} <span className="font-normal text-muted-foreground">({departments.length})</span></summary>
          <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Optional groups for your seller page. A service can also stand alone.
          </p>
          {isAdmin ? (
            <>
              <form onSubmit={handleAddDepartment} className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="New department name"
                  value={departmentName}
                  maxLength={MAX_DEPARTMENT_NAME}
                  placeholder="New department"
                  className="min-w-0 sm:flex-1"
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
                    offeringCount={offerings.filter((offering) => offering.departmentId === department.id).length}
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
          </div>
        </details>
      )}

      {offerings.length > 0 && (
        <div className="space-y-6">
          {matching.length === 0 ? <section className="rounded-[10px] border px-5 py-10 text-center">
            <h2 className="font-heading text-lg">No matching services</h2>
            <p className="mt-2 text-sm text-muted-foreground">Try another service name or description.</p>
            <Button type="button" variant="outline" className="mt-4" onClick={() => setSearch("")}>Clear search</Button>
          </section> : null}
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
