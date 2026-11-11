"use client";

import { formatBytes } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation } from "@tanstack/react-query";

// The extension is the only type information stored with a delivered file.
function fileType(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : null;
}

// Download links expire after a few minutes, so a fresh one is fetched on each click.
export function DeliveryFile({ file, getUrl }: { file: { name: string; sizeBytes: number }; getUrl: () => Promise<string> }) {
  const download = useMutation({
    mutationFn: getUrl,
    onSuccess: (url) => window.location.assign(url),
  });
  const type = fileType(file.name);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 rounded-[10px] border px-3 py-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="truncate text-sm font-medium" title={file.name}>
            {file.name}
          </p>
          <p className="font-tabular text-xs text-muted-foreground">
            {type ? `${type} · ` : ""}
            {formatBytes(file.sizeBytes)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          aria-label={`Download ${file.name}`}
          disabled={download.isPending}
          onClick={() => download.mutate()}
        >
          {download.isPending ? "Preparing…" : "Download"}
        </Button>
      </div>
      {download.error ? (
        <p role="alert" className="text-sm text-destructive">
          {download.error.message}
        </p>
      ) : null}
    </div>
  );
}
