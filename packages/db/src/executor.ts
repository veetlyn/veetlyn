import type { AnyRelations } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";

import type { relations } from "./relations";

// A Database or a transaction handle: PgAsyncTransaction extends PgAsyncDatabase (drizzle-orm
// pg-core/async/session.ts), so every query written against this type runs in both.
export type DbExecutor = PgAsyncDatabase<PostgresJsQueryResultHKT, AnyRelations>;
export type Transaction = Parameters<Parameters<DbExecutor["transaction"]>[0]>[0];
export type ProjectRelations = typeof relations;
