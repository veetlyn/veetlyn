UPDATE "ledger_entry" SET "account" = 'platform_fees' WHERE "account" = 'payleor_fees';
--> statement-breakpoint
UPDATE "ledger_balance" SET "account" = 'platform_fees' WHERE "account" = 'payleor_fees';
