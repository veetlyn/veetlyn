import type { Auth } from "@jendal-workspace/auth";
import type { RequestTarget, StoreRecord, TenantContext } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { EvlogVariables } from "evlog/hono";

export type AppEnv = {
  Variables: EvlogVariables["Variables"] & {
    db: Database;
    auth: Auth;
    target: RequestTarget;
    store: StoreRecord | null;
    tenant: TenantContext | null;
  };
};
