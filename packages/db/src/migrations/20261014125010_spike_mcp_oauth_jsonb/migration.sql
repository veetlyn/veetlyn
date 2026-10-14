ALTER TABLE "oauth_access_token" ALTER COLUMN "resources" SET DATA TYPE jsonb USING to_jsonb("resources");--> statement-breakpoint
ALTER TABLE "oauth_access_token" ALTER COLUMN "requested_user_info_claims" SET DATA TYPE jsonb USING to_jsonb("requested_user_info_claims");--> statement-breakpoint
ALTER TABLE "oauth_access_token" ALTER COLUMN "scopes" SET DATA TYPE jsonb USING to_jsonb("scopes");--> statement-breakpoint
ALTER TABLE "oauth_client" ALTER COLUMN "scopes" SET DATA TYPE jsonb USING to_jsonb("scopes");--> statement-breakpoint
ALTER TABLE "oauth_client" ALTER COLUMN "client_credentials_scopes" SET DATA TYPE jsonb USING to_jsonb("client_credentials_scopes");--> statement-breakpoint
ALTER TABLE "oauth_client" ALTER COLUMN "contacts" SET DATA TYPE jsonb USING to_jsonb("contacts");--> statement-breakpoint
ALTER TABLE "oauth_client" ALTER COLUMN "redirect_uris" SET DATA TYPE jsonb USING to_jsonb("redirect_uris");--> statement-breakpoint
ALTER TABLE "oauth_client" ALTER COLUMN "post_logout_redirect_uris" SET DATA TYPE jsonb USING to_jsonb("post_logout_redirect_uris");--> statement-breakpoint
ALTER TABLE "oauth_client" ALTER COLUMN "grant_types" SET DATA TYPE jsonb USING to_jsonb("grant_types");--> statement-breakpoint
ALTER TABLE "oauth_client" ALTER COLUMN "response_types" SET DATA TYPE jsonb USING to_jsonb("response_types");--> statement-breakpoint
ALTER TABLE "oauth_consent" ALTER COLUMN "resources" SET DATA TYPE jsonb USING to_jsonb("resources");--> statement-breakpoint
ALTER TABLE "oauth_consent" ALTER COLUMN "requested_user_info_claims" SET DATA TYPE jsonb USING to_jsonb("requested_user_info_claims");--> statement-breakpoint
ALTER TABLE "oauth_consent" ALTER COLUMN "scopes" SET DATA TYPE jsonb USING to_jsonb("scopes");--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "resources" SET DATA TYPE jsonb USING to_jsonb("resources");--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "requested_user_info_claims" SET DATA TYPE jsonb USING to_jsonb("requested_user_info_claims");--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "scopes" SET DATA TYPE jsonb USING to_jsonb("scopes");--> statement-breakpoint
ALTER TABLE "oauth_resource" ALTER COLUMN "allowed_scopes" SET DATA TYPE jsonb USING to_jsonb("allowed_scopes");