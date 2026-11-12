"use client";

import { MAX_DEPARTMENT_NAME } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import Loader from "@/components/loader";
import { WorkPage } from "@/components/page-composition";
import { RecordCard } from "@/components/record-card";
import TeamNotFound from "@/components/services-team/team-not-found";
import { categoryDescendantIds, flattenCategories } from "@/lib/catalog-categories";
import { trpc } from "@/utils/trpc";

type Category = { id: string; parentId: string | null; name: string; position: number; listed: boolean };

// One input per row: its own local state so invalidating the list does not clobber what the admin is typing.
function CategoryRow({
  teamSlug,
  category,
  categories,
  counts,
  services,
}: {
  teamSlug: string;
  category: Category & { depth: number; path: string };
  categories: Category[];
  counts: { services: number; items: number };
  services: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(category.name);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.catalog.listCategories.queryKey({ storeSlug: teamSlug }) });
    void queryClient.invalidateQueries({ queryKey: trpc.servicesCatalog.list.queryKey({ teamSlug }) });
    void queryClient.invalidateQueries({ queryKey: trpc.catalog.list.queryKey({ storeSlug: teamSlug }) });
    void queryClient.invalidateQueries({ queryKey: trpc.catalog.digitalList.queryKey({ storeSlug: teamSlug }) });
  };
  const rename = useMutation(
    trpc.catalog.renameCategory.mutationOptions({
      onSuccess: (data) => {
        setName(data.name);
        invalidate();
      },
    }),
  );
  const remove = useMutation(trpc.catalog.deleteCategory.mutationOptions({ onSuccess: invalidate }));
  const setListed = useMutation(trpc.catalog.setCategoryListed.mutationOptions({ onSuccess: invalidate }));
  const setParent = useMutation(trpc.catalog.setCategoryParent.mutationOptions({ onSuccess: invalidate }));
  const descendants = categoryDescendantIds(categories, category.id);
  const parentOptions = flattenCategories(categories.filter((candidate) => !descendants.has(candidate.id)));
  const error = rename.error ?? setListed.error ?? remove.error ?? setParent.error;

  return (
    <li className="grid gap-2 px-5 py-3.5" style={{ paddingLeft: `${20 + category.depth * 24}px` }}>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label={`Rename ${category.name}`}
          value={name}
          maxLength={MAX_DEPARTMENT_NAME}
          onChange={(event) => {
            setName(event.target.value);
            rename.reset();
          }}
          onBlur={() => {
            const value = name.trim();
            if (value !== category.name) rename.mutate({ storeSlug: teamSlug, categoryId: category.id, name: value });
          }}
          className="w-56 max-w-full"
        />
        <span className="text-sm text-muted-foreground">
          {counts.services > 0 ? `${counts.services} ${counts.services === 1 ? "service" : "services"}` : null}
          {counts.services > 0 && counts.items > 0 ? " · " : null}
          {counts.items > 0 ? `${counts.items} ${counts.items === 1 ? "item" : "items"}` : null}
          {counts.services === 0 && counts.items === 0 ? "Nothing assigned" : null}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm("Delete this category? Its services and items stay, ungrouped; subcategories move to the top level.")) {
              remove.mutate({ storeSlug: teamSlug, categoryId: category.id });
            }
          }}
        >
          Delete
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Parent</span>
          <select
            aria-label={`Parent category for ${category.name}`}
            className={`${nativeSelectClass} h-9 max-w-64`}
            value={category.parentId ?? ""}
            disabled={setParent.isPending}
            onChange={(event) => setParent.mutate({ storeSlug: teamSlug, categoryId: category.id, parentId: event.target.value || null })}
          >
            <option value="">Top level</option>
            {parentOptions.map((option) => <option key={option.id} value={option.id}>{option.path}</option>)}
          </select>
        </label>
        {services ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={category.listed}
              disabled={setListed.isPending}
              onCheckedChange={(checked) => setListed.mutate({ storeSlug: teamSlug, categoryId: category.id, listed: checked === true })}
            />
            List in AI assistants
          </label>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error.message}</p> : null}
    </li>
  );
}

// Shared catalog categories for services and premade items. A category can sit under another category.
export default function TeamCategories({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const team = useQuery({ ...trpc.store.get.queryOptions({ storeSlug: teamSlug }), retry: false, meta: { silent: true } });
  const categoriesQuery = useQuery({ ...trpc.catalog.listCategories.queryOptions({ storeSlug: teamSlug }), retry: false, meta: { silent: true } });
  const services = team.data?.product === "services";
  const offerings = useQuery({
    ...trpc.servicesCatalog.list.queryOptions({ teamSlug }),
    enabled: services,
    retry: false,
    meta: { silent: true },
  });
  const digital = useQuery({
    ...trpc.catalog.digitalList.queryOptions({ storeSlug: teamSlug }),
    enabled: services,
    retry: false,
    meta: { silent: true },
  });
  const physical = useQuery({
    ...trpc.catalog.list.queryOptions({ storeSlug: teamSlug }),
    enabled: team.data?.product === "store",
    retry: false,
    meta: { silent: true },
  });
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const add = useMutation(
    trpc.catalog.createCategory.mutationOptions({
      onSuccess: () => {
        setName("");
        setParentId("");
        void queryClient.invalidateQueries({ queryKey: trpc.catalog.listCategories.queryKey({ storeSlug: teamSlug }) });
      },
    }),
  );

  if (team.isPending || categoriesQuery.isPending) return <Loader />;
  if (team.isError || categoriesQuery.isError) return <TeamNotFound />;

  const isAdmin = services ? team.data.role === "admin" : team.data.role === "owner" || team.data.role === "admin";
  const categories = categoriesQuery.data;
  const flat = flattenCategories(categories);
  const countsFor = (categoryId: string) => ({
    services: (offerings.data?.offerings ?? []).filter((offering) => offering.departmentId === categoryId).length,
    items: services
      ? (digital.data ?? []).filter((product) => product.departmentId === categoryId).length
      : (physical.data ?? []).filter((product) => product.departmentId === categoryId).length,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim()) add.mutate({ storeSlug: teamSlug, name: name.trim(), parentId: parentId || null });
  }

  return (
    <WorkPage>
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">Categories</h1>
        <p className="text-sm text-muted-foreground">Shared by services and premade items. Categories can be nested; top-level categories have no parent.</p>
      </div>
      <RecordCard
        title="Categories"
        description={`${categories.length} ${categories.length === 1 ? "category" : "categories"}`}
        flush={categories.length > 0}
        footer={isAdmin ? (
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="new-category">New category</Label>
              <Input id="new-category" value={name} maxLength={MAX_DEPARTMENT_NAME} className="w-64 max-w-full" onChange={(event) => { setName(event.target.value); add.reset(); }} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-category-parent">Parent</Label>
              <select id="new-category-parent" className={`${nativeSelectClass} h-10 max-w-64`} value={parentId} onChange={(event) => setParentId(event.target.value)}>
                <option value="">Top level</option>
                {flat.map((category) => <option key={category.id} value={category.id}>{category.path}</option>)}
              </select>
            </div>
            <Button type="submit" variant="outline" disabled={!name.trim() || add.isPending}>{add.isPending ? "Adding…" : "Add category"}</Button>
            {add.error ? <p role="alert" className="basis-full text-sm text-destructive">{add.error.message}</p> : null}
          </form>
        ) : undefined}
      >
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No categories yet.</p>
        ) : isAdmin ? (
          <ul className="divide-y">
            {flat.map((category) => (
              <CategoryRow key={category.id} teamSlug={teamSlug} category={category} categories={categories} counts={countsFor(category.id)} services={services} />
            ))}
          </ul>
        ) : (
          <ul className="divide-y">
            {flat.map((category) => {
              const counts = countsFor(category.id);
              return (
                <li key={category.id} className="flex justify-between gap-4 py-3.5 pr-5 text-sm" style={{ paddingLeft: `${20 + category.depth * 24}px` }}>
                  <span>{category.name}</span>
                  <span className="text-muted-foreground">{counts.services + counts.items} assigned</span>
                </li>
              );
            })}
          </ul>
        )}
      </RecordCard>
    </WorkPage>
  );
}
