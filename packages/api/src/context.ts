import type { Session } from "@jendal-workspace/auth";
import type { Database } from "@jendal-workspace/db";

export type Context = {
  session: Session | null;
  db: Database;
};
