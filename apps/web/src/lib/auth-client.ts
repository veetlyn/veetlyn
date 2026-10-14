import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import type { Auth } from "@jendal-workspace/auth";
import { inferOrgAdditionalFields, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [
    organizationClient({ teams: { enabled: true }, schema: inferOrgAdditionalFields<Auth>() }),
    oauthProviderClient(),
  ],
});
