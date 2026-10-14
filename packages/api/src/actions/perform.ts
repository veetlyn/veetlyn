import type { FileStore, ServicesTeamRole } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { ProjectRow } from "@jendal-workspace/db/repositories/projects";

import type { LinkSecretSource } from "../client-links";
import type { EmailServices, PayPalServices } from "../context";

export type ActionDeps = {
  db: Database;
  files: FileStore;
  auth: LinkSecretSource;
  paypal?: PayPalServices;
  email?: EmailServices;
  now?: () => Date;
  onLogError?: (cause: unknown) => void;
};

export type Scope = { teamId: string | null; project: ProjectRow | null; role: ServicesTeamRole | null };
