import AuthSplit from "@/components/auth/auth-split";
import { redirectIfSignedIn } from "@/lib/server-api";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  await redirectIfSignedIn();
  return <AuthSplit>{children}</AuthSplit>;
}
