// Placeholder for the services team surfaces later plans deliver (S2 Discord, S3 payouts).
export default function ComingSoon({ title }: { title: string }) {
  return (
    <section aria-label={title} className="border border-dashed p-4">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Coming soon.</p>
    </section>
  );
}
