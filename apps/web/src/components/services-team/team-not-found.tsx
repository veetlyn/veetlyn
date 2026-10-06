import Link from "next/link";

export default function TeamNotFound() {
  return (
    <main className="container mx-auto max-w-3xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-semibold">Team not found</h1>
      <p className="text-sm text-muted-foreground">
        This address is not one of your stores or services teams.
      </p>
      <Link href="/" className="underline">
        Back to your workspace
      </Link>
    </main>
  );
}
