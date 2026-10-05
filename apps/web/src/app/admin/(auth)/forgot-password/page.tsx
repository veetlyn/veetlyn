import Link from "next/link";

import AuthCard from "@/components/auth/auth-card";
import ForgotPasswordForm from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email you signed up with. We'll send you a link to choose a new password."
      footer={
        <p>
          <Link href="/login" className="underline underline-offset-4">
            Back to log in
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
