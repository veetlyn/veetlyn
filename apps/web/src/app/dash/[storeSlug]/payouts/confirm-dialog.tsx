import { Button } from "@jendal-workspace/ui/components/button";
import type { RefObject } from "react";

export function ConfirmDialog({
  dialogRef,
  id,
  title,
  body,
  confirmLabel,
  onConfirm,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  id: string;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      className="m-auto max-w-md space-y-4 rounded-lg border bg-background p-6 text-foreground backdrop:bg-black/50"
    >
      <h3 id={`${id}-title`} className="text-lg font-semibold">
        {title}
      </h3>
      <p id={`${id}-body`} className="text-sm text-muted-foreground">
        {body}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => {
            dialogRef.current?.close();
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
