"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// How the business runs, in three places: the team's details, its operating model, and where it hears about work.
export default function SettingsTabs({ teamSlug }: { teamSlug: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/${teamSlug}/settings`, label: "General" },
    { href: `/${teamSlug}/settings/operating-model`, label: "Operating model" },
    { href: `/${teamSlug}/settings/channels`, label: "Channels" },
  ];
  return (
    <nav aria-label="Settings" className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto border-b px-4 pt-4 [scrollbar-width:none] md:px-7">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? "page" : undefined}
          className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
