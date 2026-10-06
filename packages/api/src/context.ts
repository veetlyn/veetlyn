import type { Auth, Session } from "@jendal-workspace/auth";
import type { TenantEnvironment } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";

export type Context = {
  session: Session | null;
  db: Database;
  environment: TenantEnvironment;
  // Procedures that act through Better Auth (organizations, stores) pass the caller's headers on.
  auth: Auth;
  headers: Headers;
};
