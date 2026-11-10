import { InvalidTransitionError, type Machine } from "@jendal-workspace/core";
import { inArray, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

// The compare-and-set half of a state machine move: the row is only updated while its stored status is still one
// `event` may start from, so a concurrent or stale writer cannot skip a step or leave a terminal state.
export function startsFrom<S extends string, E extends string>(column: PgColumn, machine: Machine<S, E>, event: E): SQL {
  return inArray(column, [...machine.sources(event)]);
}

// Throws when the guarded update matched nothing: the row had already moved on.
export function requireMoved<T, S extends string, E extends string>(
  rows: readonly T[],
  machine: Machine<S, E>,
  from: S,
  event: E,
): T {
  const [row] = rows;
  if (row === undefined) throw new InvalidTransitionError(machine.name, from, event);
  return row;
}
