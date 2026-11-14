"use client";

import { cn } from "@jendal-workspace/ui/lib/utils";
import Link from "next/link";
import { type ReactNode, useState } from "react";

// One catalog entry as a tile: a picture (or the kind's icon), then the name, one line of detail, the price and its
// state. The whole tile opens the entry; it is the only box, so nothing inside it is boxed again.
export function CatalogTile({ href, title, detail, price, status, imageUrl, icon }: {
  href: string;
  title: string;
  detail?: ReactNode;
  price?: ReactNode;
  status?: ReactNode;
  imageUrl?: string | null;
  icon: ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <Link
      href={href}
      className="group flex h-full min-w-0 flex-col overflow-hidden rounded-[12px] bg-card shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(16_16_24/0.03)] outline-none transition-shadow duration-150 hover:shadow-[0_0_0_1px_var(--border-strong),0_4px_12px_-6px_rgb(16_16_24/0.12)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className={cn("relative grid aspect-[4/3] place-items-center border-b bg-foreground/[0.025] text-muted-foreground", "[&_svg]:size-6")}>
        {imageUrl && !broken ? (
          <img src={imageUrl} alt="" onError={() => setBroken(true)} className="absolute inset-0 size-full object-cover" />
        ) : icon}
      </div>
      <div className="flex flex-1 flex-col gap-1 px-4 pt-3.5 pb-4">
        <p className="truncate text-[14px] font-medium">{title}</p>
        {detail ? <p className="truncate text-[13px] text-muted-foreground">{detail}</p> : null}
        <div className="mt-auto flex items-center justify-between gap-3 pt-2.5">
          <span className="truncate text-[14px] tabular-nums">{price}</span>
          {status}
        </div>
      </div>
    </Link>
  );
}
