CREATE TABLE "amendment" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"base_quote_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed_by_id" text,
	"note" text DEFAULT '' NOT NULL,
	"add_items" jsonb NOT NULL,
	"remove_item_ids" jsonb NOT NULL,
	"delta_minor" bigint NOT NULL,
	"management_fee_credit_minor" bigint DEFAULT 0 NOT NULL,
	"new_amount_minor" bigint NOT NULL,
	"extra_days" integer DEFAULT 0 NOT NULL,
	"resulting_quote_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp,
	CONSTRAINT "amendment_new_amount_check" CHECK (new_amount_minor > 0)
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"currency" text NOT NULL,
	"quote_part_minor" bigint NOT NULL,
	"management_fee_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"lines" jsonb NOT NULL,
	"amendment_id" text,
	"paypal_order_id" text UNIQUE,
	"paypal_capture_id" text UNIQUE,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"captured_at" timestamp,
	CONSTRAINT "payment_parts_check" CHECK (quote_part_minor >= 0 and management_fee_minor >= 0),
	CONSTRAINT "payment_amount_check" CHECK (amount_minor > 0 and amount_minor = quote_part_minor + management_fee_minor)
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"title" text NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'quoting' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"client_email" text,
	"client_discord_id" text,
	"channel_id" text,
	"assigned_freelancer_id" text,
	"currency" text NOT NULL,
	"management_fee_bps" integer NOT NULL,
	"team_cut_bps" integer NOT NULL,
	"revisions" integer DEFAULT 0 NOT NULL,
	"deadline_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_client_check" CHECK (client_email is not null or client_discord_id is not null)
);
--> statement-breakpoint
CREATE TABLE "quote" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"freelancer_id" text NOT NULL,
	"author_id" text,
	"amount_minor" bigint NOT NULL,
	"delivery_days" integer NOT NULL,
	"previous_quote_id" text,
	"amendment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp,
	CONSTRAINT "quote_amount_check" CHECK (amount_minor > 0),
	CONSTRAINT "quote_delivery_days_check" CHECK (delivery_days >= 0)
);
--> statement-breakpoint
CREATE TABLE "quote_item" (
	"id" text PRIMARY KEY,
	"quote_id" text NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"extra_days" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "quote_item_position_unique" UNIQUE("quote_id","position"),
	CONSTRAINT "quote_item_amount_check" CHECK (amount_minor > 0),
	CONSTRAINT "quote_item_extra_days_check" CHECK (extra_days >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_balance" (
	"team_id" text,
	"account" text,
	"currency" text,
	"balance_minor" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_balance_pk" PRIMARY KEY("team_id","account","currency"),
	CONSTRAINT "ledger_balance_non_negative_check" CHECK (balance_minor >= 0 or not (starts_with(account, 'client_held:') or starts_with(account, 'owed:') or starts_with(account, 'paid_out:') or account = 'client_refunds'))
);
--> statement-breakpoint
CREATE TABLE "ledger_entry" (
	"id" text PRIMARY KEY,
	"transfer_id" text NOT NULL,
	"team_id" text NOT NULL,
	"account" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entry_amount_check" CHECK (amount_minor <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transfer" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"project_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transfer_reference_unique" UNIQUE("team_id","reference")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"type" text NOT NULL,
	"project_id" text,
	"sequence" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "amendment_projectId_idx" ON "amendment" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "amendment_pending_idx" ON "amendment" ("project_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "payment_projectId_idx" ON "payment" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_deposit_idx" ON "payment" ("project_id") WHERE kind = 'deposit';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_balance_idx" ON "payment" ("project_id") WHERE kind = 'balance';--> statement-breakpoint
CREATE INDEX "project_teamId_idx" ON "project" ("team_id");--> statement-breakpoint
CREATE INDEX "quote_projectId_idx" ON "quote" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_current_idx" ON "quote" ("project_id") WHERE status = 'accepted';--> statement-breakpoint
CREATE INDEX "ledger_entry_account_idx" ON "ledger_entry" ("team_id","account","currency");--> statement-breakpoint
CREATE INDEX "ledger_entry_transferId_idx" ON "ledger_entry" ("transfer_id");--> statement-breakpoint
CREATE INDEX "ledger_transfer_projectId_idx" ON "ledger_transfer" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_project_sequence_idx" ON "outbox" ("project_id","sequence");--> statement-breakpoint
CREATE INDEX "outbox_teamId_createdAt_idx" ON "outbox" ("team_id","created_at");--> statement-breakpoint
ALTER TABLE "amendment" ADD CONSTRAINT "amendment_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "amendment" ADD CONSTRAINT "amendment_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "amendment" ADD CONSTRAINT "amendment_base_quote_id_quote_id_fkey" FOREIGN KEY ("base_quote_id") REFERENCES "quote"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "amendment" ADD CONSTRAINT "amendment_proposed_by_id_user_id_fkey" FOREIGN KEY ("proposed_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_amendment_id_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "amendment"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_assigned_freelancer_id_user_id_fkey" FOREIGN KEY ("assigned_freelancer_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_freelancer_id_user_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "quote_item" ADD CONSTRAINT "quote_item_quote_id_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_balance" ADD CONSTRAINT "ledger_balance_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id");--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_transfer_id_ledger_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "ledger_transfer"("id");--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id");--> statement-breakpoint
ALTER TABLE "ledger_transfer" ADD CONSTRAINT "ledger_transfer_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id");--> statement-breakpoint
ALTER TABLE "ledger_transfer" ADD CONSTRAINT "ledger_transfer_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id");--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE FUNCTION "ledger_rows_are_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: ledger rows are immutable', TG_OP, TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ledger_transfer_immutable" BEFORE UPDATE OR DELETE ON "ledger_transfer" FOR EACH ROW EXECUTE FUNCTION "ledger_rows_are_immutable"();
--> statement-breakpoint
CREATE TRIGGER "ledger_entry_immutable" BEFORE UPDATE OR DELETE ON "ledger_entry" FOR EACH ROW EXECUTE FUNCTION "ledger_rows_are_immutable"();
