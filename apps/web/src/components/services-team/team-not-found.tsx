import Link from "next/link";

export default function TeamNotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 md:px-7 md:py-8">
      <h1 className="font-[family-name:var(--font-display)] text-3xl">Team not found</h1>
      <p className="text-sm text-muted-foreground">
        This address is not one of your stores or services teams.
      </p>
      <Link href="/" className="underline">
        Back to your workspace
      </Link>
    </main>
  );
}
