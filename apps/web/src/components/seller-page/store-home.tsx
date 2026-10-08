export default function StoreHome({ name }: { name: string }) {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{name}</h1>
      <p className="text-muted-foreground">This store is getting ready.</p>
    </main>
  );
}
