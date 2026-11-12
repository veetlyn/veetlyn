"use client";

import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import type { TableColumn } from "@jendal-workspace/ui/components/motion/table";

import { DataList } from "@/components/data-list";
import Loader from "@/components/loader";
import { ListPage, SummaryStrip } from "@/components/page-composition";
import TeamNotFound from "@/components/services-team/team-not-found";
import { daysLabel, FULFILMENT_LABELS, priceLabel } from "@/lib/offering-labels";
import { trpc } from "@/utils/trpc";

export default function ServicesCatalog({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const catalog = useQuery({ ...trpc.servicesCatalog.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.servicesCatalog.list.queryKey({ teamSlug }) });
    void queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) });
  };
  const setOfferingActive = useMutation(trpc.servicesCatalog.setOfferingActive.mutationOptions({ onSuccess: invalidate }));
  const deleteOffering = useMutation(trpc.servicesCatalog.deleteOffering.mutationOptions({ onSuccess: invalidate }));

  if (team.isPending || catalog.isPending) return <Loader />;
  if (team.isError) return <TeamNotFound />;

  const isAdmin = team.data.role === "admin";
  const currency = team.data.settings?.currency ?? "USD";
  const departments = catalog.data?.departments ?? [];
  const offerings = catalog.data?.offerings ?? [];
  type Offering = (typeof offerings)[number];
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));
  const busy = setOfferingActive.isPending || deleteOffering.isPending;
  const visibility = (o: Offering) => (!o.active ? "hidden" : o.listed ? "listed" : "unlisted");

  const columns: TableColumn<Offering>[] = [
    {
      key: "name",
      header: "Service",
      sortable: true,
      sortValue: (o) => o.name.toLocaleLowerCase(),
      cell: (o) => (
        <span className="grid min-w-0">
          <Link href={`/${teamSlug}/services/${o.id}`} className="truncate font-medium underline-offset-4 hover:underline">{o.name}</Link>
          <span className="truncate text-xs text-muted-foreground">
            {FULFILMENT_LABELS[o.fulfilment]}
            {o.intakeQuestions.length > 0 ? ` · ${o.intakeQuestions.length} ${o.intakeQuestions.length === 1 ? "question" : "questions"}` : ""}
          </span>
        </span>
      ),
    },
    { key: "department", header: "Department", width: "176px", sortable: true, sortValue: (o) => departmentName.get(o.departmentId ?? "") ?? "", cell: (o) => <span className="truncate text-muted-foreground">{departmentName.get(o.departmentId ?? "") ?? "None"}</span> },
    { key: "price", header: "Usually costs", width: "168px", align: "right", cell: (o) => <span className="whitespace-nowrap tabular-nums">{priceLabel(o, currency)}</span> },
    { key: "days", header: "Delivery", width: "128px", cell: (o) => <span className="whitespace-nowrap">{daysLabel(o)}</span> },
    { key: "visibility", header: "Visibility", width: "176px", sortable: true, sortValue: visibility, cell: (o) => <Badge tone={visibility(o) === "listed" ? "good" : "neutral"}>{visibility(o) === "hidden" ? "Hidden" : visibility(o) === "listed" ? "Listed" : "Not in AI assistants"}</Badge> },
    ...(isAdmin ? [{
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "152px",
      align: "right" as const,
      cell: (o: Offering) => (
        <span className="flex justify-end gap-1">
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setOfferingActive.mutate({ teamSlug, offeringId: o.id, active: !o.active })}>
            {o.active ? "Hide" : "Show"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Delete this service? Projects that used it keep their records.")) deleteOffering.mutate({ teamSlug, offeringId: o.id });
            }}
          >
            Delete
          </Button>
        </span>
      ),
    }] : []),
  ];

  return (
    <ListPage>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1 basis-full space-y-1 sm:basis-auto">
          <h1 className="font-heading text-3xl">Services</h1>
          <p className="text-sm text-muted-foreground">What clients can request from your seller page.</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/${teamSlug}/departments`} className={buttonVariants({ variant: "outline" })}>Departments</Link>
          {isAdmin ? <Link href={`/${teamSlug}/services/new`} className={buttonVariants()}>Add service</Link> : null}
        </div>
      </div>

      {!catalog.isError && offerings.length > 0 ? (
        <SummaryStrip label="Catalogue summary">
          <p className="text-sm"><span className="font-medium">{offerings.filter((o) => o.active).length} services</span> <span className="text-muted-foreground">clients can request</span></p>
          <p className="text-sm text-muted-foreground">{departments.length} {departments.length === 1 ? "department" : "departments"}</p>
        </SummaryStrip>
      ) : null}
      {catalog.isError ? (
        <div role="alert" className="space-y-3 rounded-[10px] border p-5 text-sm">
          <p>The services couldn’t be loaded.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void catalog.refetch()}>Try again</Button>
        </div>
      ) : null}
      {setOfferingActive.error ?? deleteOffering.error ? <p role="alert" className="text-sm text-destructive">{(setOfferingActive.error ?? deleteOffering.error)?.message}</p> : null}
      {!catalog.isError ? (
        <DataList
          label="Services"
          rows={offerings}
          columns={columns}
          getRowId={(o) => o.id}
          searchText={(o) => `${o.name} ${o.description}`}
          searchLabel="Search services"
          filters={[
            ...(departments.length > 0 ? [{ key: "department", label: "Departments", options: [...departments.map((d) => ({ value: d.id, label: d.name })), { value: "none", label: "No department" }], match: (o: Offering, v: string) => (v === "none" ? !o.departmentId : o.departmentId === v) }] : []),
            { key: "visibility", label: "Visibility", options: [{ value: "listed", label: "Listed" }, { value: "unlisted", label: "Not in AI assistants" }, { value: "hidden", label: "Hidden" }], match: (o: Offering, v: string) => visibility(o) === v },
          ]}
          defaultSort={{ key: "name", direction: "asc" }}
          empty={{ title: "No services yet", text: isAdmin ? "Add your first service: what you make, what it usually costs and how long it takes." : "An admin adds the services: what the team makes, what it usually costs and how long it takes." }}
          noun={{ one: "service", many: "services" }}
        />
      ) : null}
    </ListPage>
  );
}
