CREATE TABLE "request_limit" (
	"key" text PRIMARY KEY,
	"window_start" bigint NOT NULL,
	"count" integer NOT NULL
);
