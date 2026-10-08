"use client";

import { formatBytes } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation } from "@tanstack/react-query";

// Download links expire after a few minutes, so a fresh one is fetched on each click.
export function DeliveryFile({ file, getUrl }: { file: { name: string; sizeBytes: number }; getUrl: () => Promise<string> }) {
  const download = useMutation({
    mutationFn: getUrl,
    onSuccess: (url) => window.location.assign(url),
  });

  return (
    <div className="space-y-1">
      <Button type="button" variant="outline" className="max-w-full" disabled={download.isPending} onClick={() => download.mutate()}>
        <span className="truncate">
          {download.isPending ? "Preparing download…" : `Download ${file.name} (${formatBytes(file.sizeBytes)})`}
        </span>
      </Button>
      {download.error ? (
        <p role="alert" className="text-sm text-destructive">
          {download.error.message}
        </p>
      ) : null}
    </div>
  );
}
