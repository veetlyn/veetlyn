// What an entity list shows: search and filters over every row, one sort over all matches, then one page. Sorting
// before paging keeps page 2 a continuation of page 1 (the table component only sorts the rows it is given).
export type ListSort = { key: string; direction: "asc" | "desc" };

export function listView<T>(
  rows: readonly T[],
  options: {
    query: string;
    searchText: (row: T) => string;
    filterValues: Record<string, string>;
    filters: Record<string, (row: T, value: string) => boolean>;
    sort: ListSort | null;
    sortValues: Record<string, (row: T) => string | number>;
    page: number;
    pageSize: number;
  },
) {
  const query = options.query.trim().toLocaleLowerCase();
  const matching = rows.filter((row) => {
    if (query && !options.searchText(row).toLocaleLowerCase().includes(query)) return false;
    return Object.entries(options.filterValues).every(([key, value]) => {
      const match = options.filters[key];
      return !match || value === "all" || value === "" || match(row, value);
    });
  });
  const value = options.sort ? options.sortValues[options.sort.key] : undefined;
  const sorted = value && options.sort
    ? [...matching].sort((a, b) => {
        const x = value(a);
        const y = value(b);
        const order = x < y ? -1 : x > y ? 1 : 0;
        return options.sort?.direction === "desc" ? -order : order;
      })
    : matching;
  const totalPages = Math.max(1, Math.ceil(sorted.length / options.pageSize));
  const page = Math.min(Math.max(1, options.page), totalPages);
  return {
    rows: sorted.slice((page - 1) * options.pageSize, page * options.pageSize),
    total: sorted.length,
    totalPages,
    page,
  };
}
