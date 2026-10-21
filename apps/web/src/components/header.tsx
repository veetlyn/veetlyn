"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

import { BrandMark } from "./brand-mark";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

const AUTH_PATHS = new Set(["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/oauth/consent"]);

// The top bar of dash pages outside a team. Team pages (TeamShell) and sign-in pages have their own frame.
export default function Header() {
  const params = useParams();
  const pathname = usePathname();
  if (params.storeSlug || AUTH_PATHS.has(pathname) || AUTH_PATHS.has(pathname.replace(/^\/dash/, ""))) return null;
  return (
    <header className="flex h-14 items-center justify-between border-b px-4 md:px-7">
      <Link href="/" className="flex items-center gap-2">
        <BrandMark className="size-6 text-foreground" />
        <span className="font-heading text-lg">Payleor</span>
      </Link>
      <div className="flex items-center gap-2">
        <ModeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
