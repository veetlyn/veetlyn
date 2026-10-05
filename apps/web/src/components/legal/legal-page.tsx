import { formatLegalDate } from "@/lib/legal-date";

export default function LegalPage({
  title,
  subtitle,
  updatedOn,
  children,
}: {
  title: string;
  subtitle?: string;
  updatedOn: Date;
  children: React.ReactNode;
}) {
  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
      {subtitle ? <p className="mt-1 text-muted-foreground">{subtitle}</p> : null}
      <p className="mt-2 text-sm text-muted-foreground">Last updated {formatLegalDate(updatedOn)}</p>
      <div className="mt-8 space-y-4">{children}</div>
      <p className="mt-12 border-t pt-4 text-sm text-muted-foreground">This text is a template and is not legal advice.</p>
    </main>
  );
}
