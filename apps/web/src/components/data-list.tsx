"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Pagination } from "@jendal-workspace/ui/components/motion/pagination";
import { Table, type TableColumn } from "@jendal-workspace/ui/components/motion/table";
import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { Frame } from "@/components/frame";
import { type ListSort, listView } from "@/lib/list-view";

export type DataListFilter<T> = {
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
  match: (row: T, value: string) => boolean;
};

const ROW_HEIGHT = 56;
// Measured: beUI's header row is 57px; inside a frame the table draws no border of its own.
const HEADER_HEIGHT = 57;

function readCell<T>(row: T, column: TableColumn<T>): ReactNode {
  if (column.cell) return column.cell(row);
  // SAFETY: a column without a renderer names a property of the row, as beUI's table reads it.
  return (row as Record<string, ReactNode>)[column.key];
}

// An entity list in a coated frame: search, filters and the count in the head strip, a sortable beUI table over
// every matching row, and pages in the foot. Rows are sorted and filtered here, so each page continues the last.
// When the frame is narrow (a phone), rows become two-line items: the title and amount, then the other cells.
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
  titleKey,
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
  /** The column that names a row; it leads each item on a phone. Defaults to the first column. */
  titleKey?: string;
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
      <Frame label={label} bodyClassName="px-5 py-10 text-center">
        <p className="font-medium">{empty.title}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{empty.text}</p>
      </Frame>
    );
  }

  const titleColumn = columns.find((column) => column.key === titleKey) ?? columns[0];
  const actionColumn = columns.find((column) => column.key === "action");
  const valueColumn = columns.find((column) => column.align === "right" && column !== actionColumn && column !== titleColumn);
  const detailColumns = columns.filter((column) => column !== titleColumn && column !== actionColumn && column !== valueColumn);

  const controls = (
    <>
      <label className="relative w-full sm:w-64">
        <span className="sr-only">{searchLabel}</span>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={`${searchLabel}…`} className="h-8 bg-card pl-8 text-[13px]" />
      </label>
      {filters.map((filter) => (
        <label key={filter.key}>
          <span className="sr-only">{filter.label}</span>
          <select
            className={cn(nativeSelectClass, "h-8 min-w-32 bg-card text-[13px]")}
            value={filterValues[filter.key] ?? "all"}
            onChange={(event) => { setFilterValues((current) => ({ ...current, [filter.key]: event.target.value })); setPage(1); }}
          >
            <option value="all">{`All ${filter.label.toLocaleLowerCase()}`}</option>
            {filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      ))}
    </>
  );

  return (
    <Frame
      label={label}
      className="@container"
      bodyClassName="overflow-hidden"
      head={<div className="flex min-w-0 flex-wrap items-center gap-2">{controls}</div>}
      actions={
        <p role="status" className="px-1 text-[13px] text-muted-foreground tabular-nums">
          {view.total} {view.total === 1 ? noun.one : noun.many}
        </p>
      }
      footer={view.totalPages > 1 ? (
        <>
          <span className="tabular-nums">Page {view.page} of {view.totalPages}</span>
          <Pagination totalPages={view.totalPages} page={view.page} onPageChange={setPage} aria-label={`${label} pages`} />
        </>
      ) : undefined}
    >
      {view.total === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="font-medium">No matching {noun.many}</p>
          <p className="mt-2 text-sm text-muted-foreground">Try another search or filter.</p>
          {filtered ? <Button type="button" variant="outline" className="mt-4" onClick={() => { setQuery(""); setFilterValues({}); setPage(1); }}>Clear filters</Button> : null}
        </div>
      ) : (
        <>
          <Table
            data={view.rows}
            columns={columns}
            getRowId={getRowId}
            sort={sort}
            onSortChange={(next) => { setSort(next); setPage(1); }}
            rowHeight={ROW_HEIGHT}
            height={view.rows.length * ROW_HEIGHT + HEADER_HEIGHT}
            className="hidden rounded-none border-0 bg-card @2xl:block"
          />
          <ul className="divide-y @2xl:hidden">
            {view.rows.map((row) => (
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
    </Frame>
  );
}
