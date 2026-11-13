"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Pagination } from "@jendal-workspace/ui/components/motion/pagination";
import { Table, type TableColumn } from "@jendal-workspace/ui/components/motion/table";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { Search } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { FilterMenu } from "@/components/filter-menu";
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

const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 40;

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
}) {
  const [query, setQuery] = useState("");
  const [viewKey, setViewKey] = useState(defaultView ?? views[0]?.key ?? "");
  const [filterValues, setFilterValues] = useState<Record<string, string>>(defaultFilters);
  const [sort, setSort] = useState<ListSort | null>(defaultSort);
  const [page, setPage] = useState(1);
  const searchRef = useRef<HTMLInputElement>(null);

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
        {views.length > 1 ? (
          <div role="group" aria-label={`${label} views`} className="-mx-1 flex max-w-full overflow-x-auto px-1 [scrollbar-width:none] max-@2xl:[mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)]">
            <div className="flex shrink-0 gap-0.5 rounded-[10px] bg-foreground/[0.05] p-[3px] shadow-(--well)">
              {views.map((v) => {
                const active = v.key === viewKey;
                const count = v.match ? rows.filter(v.match).length : rows.length;
                if (count === 0 && !active) return null;
                return (
                  <button
                    key={v.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => { setViewKey(v.key); setPage(1); }}
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] whitespace-nowrap outline-none transition-[color,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                      active ? "key-mint font-semibold text-brand-foreground" : "font-medium text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {v.label}
                    <span className={cn("tabular-nums", active ? "opacity-70" : "opacity-60")}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="flex min-w-0 basis-full items-center justify-end gap-2 @2xl:flex-1 @2xl:basis-auto">
          <label className="group relative min-w-0 flex-1 @2xl:w-60 @2xl:flex-none">
            <span className="sr-only">{searchLabel}</span>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                setQuery("");
                event.currentTarget.blur();
              }}
              placeholder={`${searchLabel}…`}
              aria-keyshortcuts="/"
              className="raised h-8 w-full rounded-[8px] pr-8 pl-8 text-base outline-none placeholder:text-muted-foreground focus-visible:shadow-[inset_0_1px_0_var(--edge-hi),0_0_0_1px_var(--ring),0_0_0_3px_color-mix(in_oklab,var(--brand)_22%,transparent)] sm:text-[13px] [&::-webkit-search-cancel-button]:hidden"
            />
            {query === "" ? (
              <kbd aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-[4px] bg-foreground/[0.06] px-1 font-sans text-[11px] text-muted-foreground group-focus-within:hidden">/</kbd>
            ) : null}
          </label>
          {filters.map((filter) => (
            <FilterMenu
              key={filter.key}
              label={filter.label}
              allLabel="All"
              value={filterValues[filter.key] ?? "all"}
              options={filter.options}
              onChange={(value) => { setFilterValues((current) => ({ ...current, [filter.key]: value })); setPage(1); }}
            />
          ))}
        </div>
      </div>

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
                  <li key={getRowId(row)} className="flex items-center gap-3 px-3.5 py-3 text-sm">
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
    </section>
  );
}
