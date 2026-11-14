"use client";

import { Input } from "@jendal-workspace/ui/components/motion/input";
import { Tabs, TabsList, TabsTrigger } from "@jendal-workspace/ui/components/motion/tabs";
import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import { LayoutGrid, List, Search } from "lucide-react";
import { useState } from "react";

export type CatalogEntry = {
  id: string;
  categoryId: string | null;
  title: string;
  description: string;
  price: string;
  meta?: string;
  href: string;
  action: string;
  actionLabel: string;
};

// What a seller offers, browsable: categories with their counts, a search, and a choice of grid or list. Entries
// are single boxes in the grid and rows of one box in the list, never a box inside a box.
export function SellerCatalog({
  id,
  title,
  entries,
  categories,
  footer,
}: {
  id: string;
  title: string;
  entries: CatalogEntry[];
  categories: { id: string; path: string }[];
  footer?: React.ReactNode;
}) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [display, setDisplay] = useState<"grid" | "list">("grid");
  const counted = categories
    .map((c) => ({ ...c, count: entries.filter((entry) => entry.categoryId === c.id).length }))
    .filter((c) => c.count > 0);
  const q = query.trim().toLocaleLowerCase();
  const showFilters = counted.length > 1;
  const showDisplay = entries.length > 2;
  const showSearch = entries.length > 4;
  const shown = entries.filter(
    (entry) =>
      (category === "all" || entry.categoryId === category) &&
      (q === "" || `${entry.title} ${entry.description}`.toLocaleLowerCase().includes(q)),
  );

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-5">
      <h2 id={`${id}-heading`} className="font-heading text-2xl">
        {title}
      </h2>
      {showFilters || showDisplay ? (
        <div className="flex flex-wrap items-center gap-2">
          {showFilters ? (
            <Tabs value={category} onValueChange={setCategory} variant="segment">
              <TabsList
                aria-label={`${title} categories`}
                wrapperClassName="w-auto max-w-full"
                className="border"
              >
                <TabsTrigger value="all" className="gap-1.5 px-2.5 py-1 text-[13px]">
                  All <span className="tabular-nums opacity-60">{entries.length}</span>
                </TabsTrigger>
                {counted.map((c) => (
                  <TabsTrigger key={c.id} value={c.id} className="gap-1.5 px-2.5 py-1 text-[13px]">
                    {c.path} <span className="tabular-nums opacity-60">{c.count}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}
          <div className="ml-auto flex min-w-0 basis-full items-center gap-2 sm:basis-auto">
            {showSearch ? (
              <Input
                type="search"
                aria-label={`Search ${title.toLocaleLowerCase()}`}
                placeholder="Search…"
                value={query}
                onChange={setQuery}
                leftIcon={<Search aria-hidden="true" />}
                className="min-w-0 flex-1 sm:w-56 sm:flex-none"
                classNames={{
                  field: "h-8 rounded-lg bg-card",
                  input: "text-base sm:text-[13px] [&::-webkit-search-cancel-button]:hidden",
                }}
              />
            ) : null}
            {showDisplay ? (
              <Tabs
                value={display}
                onValueChange={(next) => {
                  if (next === "grid" || next === "list") setDisplay(next);
                }}
                variant="segment"
              >
                <TabsList
                  aria-label={`Show ${title.toLocaleLowerCase()} as`}
                  wrapperClassName="w-auto"
                  className="border"
                >
                  <TabsTrigger value="grid" className="px-2 py-1" aria-label="Grid">
                    <LayoutGrid className="size-4" aria-hidden="true" />
                  </TabsTrigger>
                  <TabsTrigger value="list" className="px-2 py-1" aria-label="List">
                    <List className="size-4" aria-hidden="true" />
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            ) : null}
          </div>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          Nothing matches. Try another category or search.
        </p>
      ) : display === "grid" ? (
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
          {shown.map((entry) => (
            <li
              key={entry.id}
              className="flex min-w-0 flex-col gap-3 rounded-[12px] bg-card p-5 shadow-[0_0_0_1px_var(--border)]"
            >
              <h3 className="text-base font-medium">{entry.title}</h3>
              {entry.description ? (
                <p className="line-clamp-3 text-sm whitespace-pre-line text-muted-foreground">
                  {entry.description}
                </p>
              ) : null}
              <div className="mt-auto space-y-3 pt-1">
                <p className="text-sm">
                  <span className="font-tabular font-medium">{entry.price}</span>
                  {entry.meta ? (
                    <span className="text-muted-foreground"> · {entry.meta}</span>
                  ) : null}
                </p>
                <a
                  href={entry.href}
                  aria-label={entry.actionLabel}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  {entry.action}
                </a>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y rounded-[12px] bg-card shadow-[0_0_0_1px_var(--border)]">
          {shown.map((entry) => (
            <li
              key={entry.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
            >
              <div className="min-w-0">
                <h3 className="truncate text-[15px] font-medium">{entry.title}</h3>
                {entry.description ? (
                  <p className="truncate text-sm text-muted-foreground">{entry.description}</p>
                ) : null}
              </div>
              <p className="text-right text-sm">
                <span className="block font-tabular font-medium">{entry.price}</span>
                {entry.meta ? (
                  <span className="block text-muted-foreground">{entry.meta}</span>
                ) : null}
              </p>
              <a
                href={entry.href}
                aria-label={entry.actionLabel}
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: "col-span-2 justify-self-start sm:col-span-1",
                })}
              >
                {entry.action}
              </a>
            </li>
          ))}
        </ul>
      )}
      {footer}
    </section>
  );
}
