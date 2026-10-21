CREATE TABLE "conversation_message" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"space" text NOT NULL,
	"author_kind" text NOT NULL,
	"author_user_id" text,
	"author_contact_id" text,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"shown_body" text NOT NULL,
	"reply_to_id" text,
	"ref_type" text,
	"ref_id" text,
	"surface" text,
	"discord_message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_department" (
	"team_id" text NOT NULL,
	"user_id" text,
	"department_id" text,
	CONSTRAINT "member_department_pkey" PRIMARY KEY("user_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "request_shortlist" (
	"project_id" text,
	"user_id" text,
	CONSTRAINT "request_shortlist_pkey" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "jwks" (
	"id" text PRIMARY KEY,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "oauth_access_token" (
	"id" text PRIMARY KEY,
	"token" text UNIQUE,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" jsonb,
	"requested_user_info_claims" jsonb,
	"refresh_id" text,
	"expires_at" timestamp,
	"created_at" timestamp,
	"revoked" timestamp,
	"confirmation" jsonb,
	"scopes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_client" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL UNIQUE,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" jsonb,
	"client_credentials_scopes" jsonb,
	"user_id" text,
	"created_at" timestamp,
	"updated_at" timestamp,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" jsonb,
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" jsonb NOT NULL,
	"post_logout_redirect_uris" jsonb,
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" jsonb,
	"response_types" jsonb,
	"require_pkce" boolean,
	"dpop_bound_access_tokens" boolean DEFAULT false,
	"reference_id" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "oauth_client_assertion" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_client_resource" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_consent" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"resources" jsonb,
	"requested_user_info_claims" jsonb,
	"scopes" jsonb NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_token" (
	"id" text PRIMARY KEY,
	"token" text NOT NULL UNIQUE,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" jsonb,
	"requested_user_info_claims" jsonb,
	"expires_at" timestamp,
	"created_at" timestamp,
	"revoked" timestamp,
	"rotated_at" timestamp,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp,
	"auth_time" timestamp,
	"confirmation" jsonb,
	"scopes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_resource" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" jsonb,
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"created_at" timestamp,
	"updated_at" timestamp,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "services_department" ADD COLUMN "listed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "services_offering" ADD COLUMN "listed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "client_home_surface" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "declined_reason" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "declined_at" timestamp;--> statement-breakpoint
CREATE INDEX "conversation_message_project_idx" ON "conversation_message" ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "member_department_team_idx" ON "member_department" ("team_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_clientId_idx" ON "oauth_access_token" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_sessionId_idx" ON "oauth_access_token" ("session_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_userId_idx" ON "oauth_access_token" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_authorizationCodeId_idx" ON "oauth_access_token" ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_refreshId_idx" ON "oauth_access_token" ("refresh_id");--> statement-breakpoint
CREATE INDEX "oauth_client_userId_idx" ON "oauth_client" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_client_resource_clientId_idx" ON "oauth_client_resource" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_client_resource_resourceId_idx" ON "oauth_client_resource" ("resource_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_clientId_idx" ON "oauth_consent" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_userId_idx" ON "oauth_consent" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_clientId_idx" ON "oauth_refresh_token" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_sessionId_idx" ON "oauth_refresh_token" ("session_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_userId_idx" ON "oauth_refresh_token" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_authorizationCodeId_idx" ON "oauth_refresh_token" ("authorization_code_id");--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_author_user_id_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_author_contact_id_client_contact_id_fkey" FOREIGN KEY ("author_contact_id") REFERENCES "client_contact"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "member_department" ADD CONSTRAINT "member_department_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member_department" ADD CONSTRAINT "member_department_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member_department" ADD CONSTRAINT "member_department_department_id_services_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "services_department"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "request_shortlist" ADD CONSTRAINT "request_shortlist_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "request_shortlist" ADD CONSTRAINT "request_shortlist_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refresh_id_oauth_refresh_token_id_fkey" FOREIGN KEY ("refresh_id") REFERENCES "oauth_refresh_token"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_dn2L1gs9Dolm_fkey" FOREIGN KEY ("resource_id") REFERENCES "oauth_resource"("identifier") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;