// Sign-up and "Send a new link" return here after verification. Sign-in must not pass it (Fact 14).
export const VERIFIED_EMAIL_REDIRECT = "/new/services-team";
export const RESET_PASSWORD_PATH = "/reset-password";
export const TOO_MANY_ATTEMPTS = "Too many attempts. Try again in a few minutes.";

export type AuthClientError = { status: number; code?: string | undefined; message?: string | undefined };

export function authErrorMessage(error: AuthClientError, fallback: string): string {
  if (error.status === 429) return TOO_MANY_ATTEMPTS;
  return error.message || fallback;
}

export function isEmailNotVerified(error: AuthClientError): boolean {
  return error.code === "EMAIL_NOT_VERIFIED";
}

export function verifyEmailPath(email: string): string {
  return `/verify-email?email=${encodeURIComponent(email)}`;
}
