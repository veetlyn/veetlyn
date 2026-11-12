import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { cn } from "@jendal-workspace/ui/lib/utils";

export default function TextField({
  id,
  label,
  hint,
  className,
  "aria-describedby": describedBy,
  ...input
}: { id: string; label: string; hint?: string } & React.ComponentProps<typeof Input>) {
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input {...input} className={cn("h-10 rounded-lg text-base md:text-sm", className)} id={id} aria-describedby={[describedBy, hint ? hintId : undefined].filter(Boolean).join(" ") || undefined} />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
