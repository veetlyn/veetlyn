-- Leaving notices were warning marks with a fixed note; they get their own kind so no warning note can pass for one.
UPDATE "member_mark" SET "kind" = 'leaving_notice', "note" = NULL WHERE "kind" = 'warning' AND "note" = 'leaving notice' AND "project_id" IS NULL;
