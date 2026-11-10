import { getTableColumns, getTableName, isTable } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as schema from "./schema";
import { renderStateMachinesDoc, STATUS_MACHINES, UNMANAGED_STATUS_COLUMNS } from "./state-machines";

const statusColumns = Object.values(schema).flatMap((value) => {
  if (!isTable(value)) return [];
  const status = Object.entries(getTableColumns(value)).find(([name]) => name === "status")?.[1];
  return status ? [{ table: getTableName(value), values: status.enumValues ?? null }] : [];
});

describe("status machines", () => {
  // A new status column, or a status added to an enum without its moves, would otherwise be an implicit machine again.
  it("owns every stored status column, with exactly the machine's states", () => {
    const owned = new Map(STATUS_MACHINES.map((entry) => [entry.table, entry.machine]));
    for (const column of statusColumns) {
      const machine = owned.get(column.table);
      if (!machine) {
        expect(UNMANAGED_STATUS_COLUMNS, `status column of ${column.table} has no machine`).toHaveProperty(column.table);
        continue;
      }
      if (column.values) expect([...column.values].sort(), column.table).toEqual([...machine.states].sort());
    }
    expect(statusColumns.map((column) => column.table).sort()).toEqual(
      [...STATUS_MACHINES.map((entry) => entry.table), ...Object.keys(UNMANAGED_STATUS_COLUMNS)].sort(),
    );
  });

  it("keeps docs/state-machines.md in step with the machines", async () => {
    await expect(renderStateMachinesDoc()).toMatchFileSnapshot("../../../docs/state-machines.md");
  });
});
