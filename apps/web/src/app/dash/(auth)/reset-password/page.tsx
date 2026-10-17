import { z } from "zod";

import AuthCard from "@/components/auth/auth-card";
import InvalidResetLink from "@/components/auth/invalid-reset-link";
import ResetPasswordForm from "@/components/auth/reset-password-form";

// A repeated query parameter arrives as an array; only a single token value is usable.
const resetSearchParamsSchema = z.object({
  token: z.string().optional().catch(undefined),
  error: z.union([z.string(), z.array(z.string())]).optional().catch(undefined),
});

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, error } = resetSearchParamsSchema.parse(await searchParams);

  return (
    <AuthCard title="Choose a new password">
      {token && !error ? <ResetPasswordForm token={token} /> : <InvalidResetLink />}
    </AuthCard>
  );
}
