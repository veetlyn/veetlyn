export default function StoreHome({ name }: { name: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 md:px-7 md:py-8">
      <h1 className="font-[family-name:var(--font-display)] text-3xl">{name}</h1>
      <p className="text-muted-foreground">This store is getting ready.</p>
    </main>
  );
}
