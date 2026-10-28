CREATE TABLE "launch_waitlist" (
	"email" text PRIMARY KEY,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
