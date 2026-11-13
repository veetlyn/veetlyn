import { describe, expect, it } from "vitest";

import { listView } from "./list-view";

type Row = { id: string; title: string; kind: "service" | "item"; amount: number };
const rows: Row[] = Array.from({ length: 45 }, (_, i) => ({
  id: `r${i}`,
  title: i % 2 ? `Logo ${i}` : `Site ${i}`,
  kind: i % 3 ? "service" : "item",
  amount: (i * 7) % 50,
}));

const base = {
  searchText: (row: Row) => row.title,
  sortValues: { amount: (row: Row) => row.amount, title: (row: Row) => row.title },
  filters: { kind: (row: Row, value: string) => row.kind === value },
  pageSize: 20,
};

describe("listView", () => {
  it("sorts every matching row before taking a page, so page 2 continues page 1", () => {
    const first = listView(rows, { ...base, query: "", filterValues: {}, sort: { key: "amount", direction: "asc" }, page: 1 });
    const second = listView(rows, { ...base, query: "", filterValues: {}, sort: { key: "amount", direction: "asc" }, page: 2 });
    expect(first.total).toBe(45);
    expect(first.totalPages).toBe(3);
    expect(first.rows).toHaveLength(20);
    expect(first.rows.at(-1)!.amount).toBeLessThanOrEqual(second.rows[0]!.amount);
  });

  it("applies search and filters together, case-insensitively", () => {
    const view = listView(rows, { ...base, query: "LOGO", filterValues: { kind: "item" }, sort: null, page: 1 });
    expect(view.rows.every((row) => row.title.startsWith("Logo") && row.kind === "item")).toBe(true);
    expect(view.total).toBe(rows.filter((row) => row.title.startsWith("Logo") && row.kind === "item").length);
  });

  it("treats 'all' as no filter and clamps a page past the end to the last page", () => {
    const view = listView(rows, { ...base, query: "", filterValues: { kind: "all" }, sort: null, page: 9 });
    expect(view.total).toBe(45);
    expect(view.page).toBe(3);
    expect(view.rows).toHaveLength(5);
  });

  it("reports one empty page when nothing matches", () => {
    const view = listView(rows, { ...base, query: "nothing", filterValues: {}, sort: null, page: 1 });
    expect(view).toMatchObject({ total: 0, totalPages: 1, page: 1, rows: [] });
  });
});
