"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Pagination } from "@jendal-workspace/ui/components/motion/pagination";
import { Table, type TableColumn } from "@jendal-workspace/ui/components/motion/table";
import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { type ListSort, listView } from "@/lib/list-view";

export type DataListFilter<T> = {
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
  match: (row: T, value: string) => boolean;
};

const ROW_HEIGHT = 56;
// Measured: beUI's header row is 57px and the frame adds a 1px border on each side.
const HEADER_HEIGHT = 59;

// An entity list: search, filters, a sortable beUI table over every matching row, and pages. Rows are sorted and
// filtered here, so each page continues the last.
export function DataList<T>({
  label,
  rows,
  columns,
  getRowId,
  searchText,
  searchLabel,
  filters = [],
  defaultSort = null,
  defaultFilters = {},
  pageSize = 20,
  empty,
  noun,
}: {
  label: string;
  rows: readonly T[];
  columns: TableColumn<T>[];
  getRowId: (row: T) => string;
  searchText: (row: T) => string;
  searchLabel: string;
  filters?: DataListFilter<T>[];
  defaultSort?: ListSort | null;
  defaultFilters?: Record<string, string>;
  pageSize?: number;
  empty: { title: string; text: string };
  noun: { one: string; many: string };
}) {
  const [query, setQuery] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>(defaultFilters);
  const [sort, setSort] = useState<ListSort | null>(defaultSort);
  const [page, setPage] = useState(1);
  const sortValues = useMemo(() => {
    const values: Record<string, (row: T) => string | number> = {};
    for (const column of columns) if (column.sortValue) values[column.key] = column.sortValue;
    return values;
  }, [columns]);
  const matchers = useMemo(() => Object.fromEntries(filters.map((f) => [f.key, f.match])), [filters]);
  const view = listView(rows, { query, searchText, filterValues, filters: matchers, sort, sortValues, page, pageSize });
  const filtered = query.trim() !== "" || Object.values(filterValues).some((v) => v && v !== "all");

  if (rows.length === 0) {
    return (
      <section className="rounded-[10px] border px-5 py-10 text-center">
        <h2 className="font-heading text-lg">{empty.title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{empty.text}</p>
      </section>
    );
  }

  return (
    <section aria-label={label} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-72">
          <span className="sr-only">{searchLabel}</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={`${searchLabel}…`} className="pl-9" />
        </label>
        {filters.map((filter) => (
          <label key={filter.key}>
            <span className="sr-only">{filter.label}</span>
            <select
              className={cn(nativeSelectClass, "h-10 min-w-36")}
              value={filterValues[filter.key] ?? "all"}
              onChange={(event) => { setFilterValues((current) => ({ ...current, [filter.key]: event.target.value })); setPage(1); }}
            >
              <option value="all">{`All ${filter.label.toLocaleLowerCase()}`}</option>
              {filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        ))}
        <p role="status" className="ml-auto text-sm text-muted-foreground tabular-nums">
          {view.total} {view.total === 1 ? noun.one : noun.many}
        </p>
      </div>
      {view.total === 0 ? (
        <div className="rounded-[10px] border px-5 py-10 text-center">
          <h2 className="font-heading text-lg">No matching {noun.many}</h2>
          <p className="mt-2 text-sm text-muted-foreground">Try another search or filter.</p>
          {filtered ? <Button type="button" variant="outline" className="mt-4" onClick={() => { setQuery(""); setFilterValues({}); setPage(1); }}>Clear filters</Button> : null}
        </div>
      ) : (
        <Table
          data={view.rows}
          columns={columns}
          getRowId={getRowId}
          sort={sort}
          onSortChange={(next) => { setSort(next); setPage(1); }}
          rowHeight={ROW_HEIGHT}
          height={view.rows.length * ROW_HEIGHT + HEADER_HEIGHT}
          className="rounded-[10px]"
        />
      )}
      {view.totalPages > 1 ? (
        <div className="flex justify-center">
          <Pagination totalPages={view.totalPages} page={view.page} onPageChange={setPage} aria-label={`${label} pages`} />
        </div>
      ) : null}
    </section>
  );
}
