ALTER TABLE "ledger_entry" DISABLE TRIGGER "ledger_entry_immutable";
--> statement-breakpoint
UPDATE "ledger_entry" SET "account" = 'platform_fees' WHERE "account" = 'payleor_fees';
--> statement-breakpoint
ALTER TABLE "ledger_entry" ENABLE TRIGGER "ledger_entry_immutable";
--> statement-breakpoint
UPDATE "ledger_balance" SET "account" = 'platform_fees' WHERE "account" = 'payleor_fees';
