import { redirectIfSignedIn } from "@/lib/server-api";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  await redirectIfSignedIn();
  return (
    <main className="flex flex-1 justify-center px-4 py-10 md:py-16">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
