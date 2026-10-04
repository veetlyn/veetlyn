import type { Session } from "@jendal-workspace/auth";
import type { TenantEnvironment } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";

export type Context = {
  session: Session | null;
  db: Database;
  environment: TenantEnvironment;
};
