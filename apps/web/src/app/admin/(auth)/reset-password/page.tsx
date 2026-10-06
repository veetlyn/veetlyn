import AuthCard from "@/components/auth/auth-card";
import InvalidResetLink from "@/components/auth/invalid-reset-link";
import ResetPasswordForm from "@/components/auth/reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  return (
    <AuthCard title="Choose a new password">
      {typeof token === "string" && token && !error ? <ResetPasswordForm token={token} /> : <InvalidResetLink />}
    </AuthCard>
  );
}
