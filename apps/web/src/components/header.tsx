"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { BrandMark } from "./brand-mark";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

// The top bar of dash pages outside a team. Team pages have their own frame (TeamShell).
export default function Header() {
  const params = useParams();
  if (params.storeSlug) return null;
  return (
    <header className="flex h-14 items-center justify-between border-b px-4 md:px-7">
      <Link href="/" className="flex items-center gap-2">
        <BrandMark className="size-6 text-foreground" />
        <span className="font-[family-name:var(--font-display)] text-lg">Payleor</span>
      </Link>
      <div className="flex items-center gap-2">
        <ModeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
