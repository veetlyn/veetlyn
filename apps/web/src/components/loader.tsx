import { Loader2 } from "lucide-react";

export default function Loader() {
  return (
    <div role="status" className="flex min-h-40 items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
      <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
      <span>Loading…</span>
    </div>
  );
}
