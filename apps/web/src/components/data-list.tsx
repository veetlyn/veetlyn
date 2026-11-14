"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Pagination } from "@jendal-workspace/ui/components/motion/pagination";
import { Input } from "@jendal-workspace/ui/components/motion/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@jendal-workspace/ui/components/motion/select";
import { Table, type TableColumn } from "@jendal-workspace/ui/components/motion/table";
import { Tabs, TabsList, TabsTrigger } from "@jendal-workspace/ui/components/motion/tabs";
import { LayoutGrid, List, Search } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { type ListSort, listView } from "@/lib/list-view";

export type DataListFilter<T> = {
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
  match: (row: T, value: string) => boolean;
};

/** A slice of the list, shown as a segment with its count ("Needs review 2"). The first view is the default unless
 * another is named; a view with no rows is left out. */
export type DataListView<T> = { key: string; label: string; match?: (row: T) => boolean };

const ROW_HEIGHT = 60;
const HEADER_HEIGHT = 46;

function readCell<T>(row: T, column: TableColumn<T>): ReactNode {
  if (column.cell) return column.cell(row);
  // SAFETY: a column without a renderer names a property of the row, as beUI's table reads it.
  return (row as Record<string, ReactNode>)[column.key];
}

// An entity list: views with their counts, then search and filters on one toolbar row; under it a coated card
// holds the sortable table and a foot strip with the count and pages. Rows are sorted and filtered here, so each
// page continues the last. When the card is narrow (a phone), rows become two-line items: the title and amount,
// then the other cells.
export function DataList<T>({
  label,
  title,
  rows,
  columns,
  getRowId,
  searchText,
  searchLabel,
  views = [],
  defaultView,
  filters = [],
  defaultSort = null,
  defaultFilters = {},
  pageSize = 20,
  empty,
  noun,
  titleKey,
  gridItem,
}: {
  label: string;
  /** A heading for a list that sits inside a larger page; it leads the toolbar row. */
  title?: ReactNode;
  rows: readonly T[];
  columns: TableColumn<T>[];
  getRowId: (row: T) => string;
  searchText: (row: T) => string;
  searchLabel: string;
  views?: DataListView<T>[];
  defaultView?: string;
  filters?: DataListFilter<T>[];
  defaultSort?: ListSort | null;
  defaultFilters?: Record<string, string>;
  pageSize?: number;
  empty: { title: string; text: string };
  noun: { one: string; many: string };
  /** The column that names a row; it leads each item on a phone. Defaults to the first column. */
  titleKey?: string;
  /** A tile for the row. With it, the list can also be shown as a grid of tiles. */
  gridItem?: (row: T) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [viewKey, setViewKey] = useState(defaultView ?? views[0]?.key ?? "");
  const [filterValues, setFilterValues] = useState<Record<string, string>>(defaultFilters);
  const [sort, setSort] = useState<ListSort | null>(defaultSort);
  const [page, setPage] = useState(1);
  const searchRef = useRef<HTMLInputElement>(null);
  // List or grid, remembered per list in this browser; storage can be unavailable, so it falls back to the list.
  const displayKey = `display.${label}`;
  const [display, setDisplay] = useState<"list" | "grid">("list");
  useEffect(() => {
    if (!gridItem) return;
    try {
      if (window.localStorage.getItem(displayKey) === "grid") setDisplay("grid");
    } catch {
      // Private windows and blocked storage keep the default.
    }
  }, [displayKey, gridItem]);
  const chooseDisplay = (next: string) => {
    if (next !== "list" && next !== "grid") return;
    setDisplay(next);
    try {
      window.localStorage.setItem(displayKey, next);
    } catch {
      // The choice still applies for this visit.
    }
  };

  // "/" focuses the search from anywhere on the page, as in most list tools. Keyboard focus never animates.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true]");
      if (event.key !== "/" || typing || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sortValues = useMemo(() => {
    const values: Record<string, (row: T) => string | number> = {};
    for (const column of columns) if (column.sortValue) values[column.key] = column.sortValue;
    return values;
  }, [columns]);
  const matchers = useMemo(() => Object.fromEntries(filters.map((f) => [f.key, f.match])), [filters]);
  const view = views.find((v) => v.key === viewKey);
  const shownViews = views
    .map((v) => ({ view: v, count: v.match ? rows.filter(v.match).length : rows.length }))
    .filter(({ view: v, count }) => count > 0 || v.key === viewKey);
  const inView = view?.match ? rows.filter(view.match) : rows;
  const list = listView(inView, { query, searchText, filterValues, filters: matchers, sort, sortValues, page, pageSize });
  const filtered = query.trim() !== "" || Object.values(filterValues).some((v) => v && v !== "all");

  if (rows.length === 0) {
    return (
      <section aria-label={label} className="min-w-0 space-y-3">
        {title ? <h2 className="text-sm font-medium">{title}</h2> : null}
        <div className="frame frame-panel"><div className="frame frame-body px-5 py-12 text-center">
          <p className="font-medium">{empty.title}</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{empty.text}</p>
        </div></div>
      </section>
    );
  }

  const titleColumn = columns.find((column) => column.key === titleKey) ?? columns[0];
  const actionColumn = columns.find((column) => column.key === "action");
  const valueColumn = columns.find((column) => column.align === "right" && column !== actionColumn && column !== titleColumn);
  const detailColumns = columns.filter((column) => column !== titleColumn && column !== actionColumn && column !== valueColumn);
  const clear = () => {
    setQuery("");
    setFilterValues({});
    setPage(1);
  };

  return (
    <section aria-label={label} className="@container min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {title ? <h2 className="mr-2 text-sm font-medium">{title}</h2> : null}
        {shownViews.length > 1 ? (
          <Tabs value={viewKey} onValueChange={(next) => { setViewKey(next); setPage(1); }} variant="segment">
            <TabsList aria-label={`${label} views`} wrapperClassName="w-auto max-w-full" className="border">
              {shownViews.map(({ view: v, count }) => (
                <TabsTrigger key={v.key} value={v.key} className="gap-1.5 px-2.5 py-1 text-[13px]">
                  {v.label}
                  <span className="tabular-nums opacity-60">{count}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}
        <div className="flex min-w-0 basis-full items-center justify-end gap-2 @2xl:flex-1 @2xl:basis-auto">
          <Input
            ref={searchRef}
            type="search"
            aria-label={searchLabel}
            aria-keyshortcuts="/"
            value={query}
            onChange={(next) => { setQuery(next); setPage(1); }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              setQuery("");
              event.currentTarget.blur();
            }}
            placeholder={`${searchLabel}…`}
            leftIcon={<Search aria-hidden="true" />}
            rightIcon={query === "" ? <kbd aria-hidden="true" className="mr-2 flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-foreground/[0.06] px-1 font-sans text-[12px]">/</kbd> : undefined}
            className="min-w-0 flex-1 @2xl:w-60 @2xl:flex-none"
            classNames={{ field: "h-8 rounded-lg bg-card", input: "text-base sm:text-[13px] [&::-webkit-search-cancel-button]:hidden" }}
          />
          {filters.map((filter) => (
            <Select
              key={filter.key}
              value={filterValues[filter.key] ?? "all"}
              onValueChange={(value) => { setFilterValues((current) => ({ ...current, [filter.key]: value })); setPage(1); }}
              className="z-30 w-40 shrink-0"
            >
              <SelectTrigger className="h-8 py-0 text-[13px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="text-muted-foreground">{filter.label}</span>
                  <SelectValue className="truncate" />
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {filter.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          ))}
          {gridItem ? (
            <Tabs value={display} onValueChange={chooseDisplay} variant="segment">
              <TabsList aria-label={`Show ${noun.many} as`} wrapperClassName="w-auto" className="border">
                <TabsTrigger value="list" className="px-2 py-1" aria-label="List"><List className="size-4" aria-hidden="true" /></TabsTrigger>
                <TabsTrigger value="grid" className="px-2 py-1" aria-label="Grid"><LayoutGrid className="size-4" aria-hidden="true" /></TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
        </div>
      </div>

      {gridItem && display === "grid" && list.total > 0 ? (
        <>
          <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(232px,1fr))]">
            {list.rows.map((row) => <li key={getRowId(row)} className="min-w-0">{gridItem(row)}</li>)}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-foreground">
            <p role="status" className="tabular-nums">
              {list.total} {list.total === 1 ? noun.one : noun.many}
              {view?.match || filtered ? <span className="opacity-70"> of {rows.length}</span> : null}
            </p>
            {list.totalPages > 1 ? <Pagination totalPages={list.totalPages} page={list.page} onPageChange={setPage} aria-label={`${label} pages`} /> : null}
          </div>
        </>
      ) : (
      <div className="frame frame-panel min-w-0">
        <div className="frame frame-body overflow-hidden">
          {list.total === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="font-medium">No matching {noun.many}</p>
              <p className="mt-1.5 text-sm text-muted-foreground">{filtered ? "Try another search or filter." : `No ${noun.many} in this view.`}</p>
              {filtered ? <Button type="button" variant="outline" size="sm" className="mt-4" onClick={clear}>Clear search and filters</Button> : null}
            </div>
          ) : (
            <>
              <Table
                data={list.rows}
                columns={columns}
                getRowId={getRowId}
                sort={sort}
                onSortChange={(next) => { setSort(next); setPage(1); }}
                rowHeight={ROW_HEIGHT}
                headerHeight={HEADER_HEIGHT}
                fill={false}
                height={list.rows.length * ROW_HEIGHT + HEADER_HEIGHT + 1}
                className="hidden rounded-none border-0 bg-card @2xl:block"
              />
              <ul className="divide-y @2xl:hidden">
                {list.rows.map((row) => (
                  <li key={getRowId(row)} className="flex items-center gap-3 px-5 py-4 text-sm">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 font-medium [&_.truncate]:whitespace-normal">{readCell(row, titleColumn)}</div>
                        {valueColumn ? <div className="shrink-0 text-right font-medium tabular-nums">{readCell(row, valueColumn)}</div> : null}
                      </div>
                      {detailColumns.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {detailColumns.map((column) => <span key={column.key} className="inline-flex min-w-0 items-center [&:empty]:hidden">{readCell(row, column)}</span>)}
                        </div>
                      ) : null}
                    </div>
                    {actionColumn ? <div className="shrink-0 empty:hidden">{readCell(row, actionColumn)}</div> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="frame-foot">
          <p role="status" className="tabular-nums">
            {list.total} {list.total === 1 ? noun.one : noun.many}
            {view?.match || filtered ? <span className="opacity-70"> of {rows.length}</span> : null}
          </p>
          {list.totalPages > 1 ? <Pagination totalPages={list.totalPages} page={list.page} onPageChange={setPage} aria-label={`${label} pages`} /> : null}
        </div>
      </div>
      )}
    </section>
  );
}
