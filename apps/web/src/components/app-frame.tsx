"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@jendal-workspace/ui/components/dropdown-menu";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { ChevronDown, ChevronRight, Search, SquarePen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { BrandWordmark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";

export type CrumbOption = { href: string; label: string; detail?: string };
// A crumb with options is a switcher: its menu lists the places at the same level. Crumbs whose choices the sidebar
// already lists stay plain links.
export type Crumb = { href: string; label: string; options?: CrumbOption[]; menuLabel?: string };
export type SearchItem = { href: string; label: string; detail?: string };

// The dash frame at every level of the context tree: the node's sidebar on the tray, the page on a framed canvas with
// the breadcrumb and search on top. Only the canvas scrolls.
export default function AppFrame({
  sidebar,
  mobileNav,
  crumbs,
  chatsPath,
  searchItems = [],
  ask,
  banner,
  fill = false,
  children,
}: {
  sidebar: React.ReactNode;
  mobileNav?: React.ReactNode;
  crumbs: Crumb[];
  // Where "New thread" goes at this node; no button when the node has no assistant.
  chatsPath?: string;
  searchItems?: SearchItem[];
  ask?: React.ReactNode;
  banner?: React.ReactNode;
  // A conversation holds its own scrolling: it takes the height left under the banners.
  fill?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-app-shell
      className={cn("grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] bg-tray", "md:grid-cols-[248px_minmax(0,1fr)]")}
    >
      <aside data-scroll className={cn("hidden min-h-0 flex-col gap-0.5 overflow-y-auto px-[5px] pt-[5px] pb-1.5", "md:flex")}>
        <Link href="/" className="flex h-10 items-center px-2.5">
          <BrandWordmark className="font-heading text-[18px] text-foreground" />
          <span className="sr-only">Your account</span>
        </Link>
        {chatsPath ? (
          <Link
            href={chatsPath}
            className="mb-1 flex items-center gap-2.5 rounded-[6px] px-2.5 py-[7px] text-[15px] font-medium text-foreground hover:bg-foreground/[0.05]"
          >
            <SquarePen className="size-4" aria-hidden="true" />
            New thread
          </Link>
        ) : null}
        {sidebar}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col bg-card md:my-2 md:mr-2 md:frame md:rounded-[10px]">
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b px-4 md:px-5">
          <Link href="/" className="md:hidden">
            <BrandWordmark className="font-heading text-[16px]" />
            <span className="sr-only">Your account</span>
          </Link>
          <Breadcrumb crumbs={crumbs} />
          <div className="ml-auto flex items-center gap-2">
            <SearchBar items={searchItems} />
            <ModeToggle />
            <UserMenu />
          </div>
        </div>
        {mobileNav ? (
          <nav
            aria-label="Sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2 [scrollbar-width:none] md:hidden"
          >
            {mobileNav}
          </nav>
        ) : null}
        <div
          id="page-scroll"
          data-scroll
          className={cn(
            "min-h-0 flex-1 motion-safe:scroll-smooth",
            fill ? "flex flex-col overflow-hidden" : "overflow-y-auto",
          )}
        >
          {banner}
          {children}
        </div>
        {ask}
      </div>
    </div>
  );
}

function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[15px] text-muted-foreground">
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={`${crumb.href}-${i}`} className={cn("min-w-0 items-center gap-1", last ? "flex" : "hidden md:flex")}>
            {i > 0 ? <ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground/60 md:block" aria-hidden="true" /> : null}
            {crumb.options && crumb.options.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    "flex min-w-0 items-center gap-1 rounded-[6px] px-1.5 py-1 hover:bg-foreground/[0.05] hover:text-foreground",
                    last && "font-medium text-foreground",
                  )}
                  aria-label={`${crumb.label}. Switch ${crumb.menuLabel ?? "place"}`}
                >
                  <span className="truncate">{crumb.label}</span>
                  <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-h-[60vh] min-w-56 overflow-y-auto bg-card" align="start">
                  <DropdownMenuGroup>
                    {crumb.menuLabel ? <DropdownMenuLabel>{crumb.menuLabel}</DropdownMenuLabel> : null}
                    {crumb.options.map((option) => (
                      <DropdownMenuItem key={option.href} render={<Link href={option.href} />}>
                        <span className="grid min-w-0">
                          <span className={cn("truncate", option.href === crumb.href && "font-medium")}>{option.label}</span>
                          {option.detail ? <span className="truncate text-xs text-muted-foreground">{option.detail}</span> : null}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : last ? (
              <span className="truncate px-1.5 font-medium text-foreground">{crumb.label}</span>
            ) : (
              <Link href={crumb.href} className="truncate rounded-[6px] px-1.5 py-1 hover:bg-foreground/[0.05] hover:text-foreground">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// Search in the top bar: jump to any page or place at this node. ⌘K or Ctrl K focuses it.
function SearchBar({ items }: { items: SearchItem[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    return items
      .filter((item) => !seen.has(item.href) && seen.add(item.href))
      .filter((item) => !q || `${item.label} ${item.detail ?? ""}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [items, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    input.current?.blur();
    router.push(href);
  };

  return (
    <div className="relative hidden lg:block">
      <label className="flex h-8 w-64 items-center gap-2 rounded-[6px] bg-foreground/[0.04] px-2.5 text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] focus-within:shadow-[inset_0_0_0_1px_var(--foreground)]">
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="sr-only">Search</span>
        <input
          ref={input}
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls="dash-search-results"
          aria-autocomplete="list"
          value={query}
          placeholder="Search pages and places"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((i) => Math.min(i + 1, matches.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (event.key === "Enter" && matches[active]) {
              event.preventDefault();
              go(matches[active].href);
            } else if (event.key === "Escape") {
              setOpen(false);
              input.current?.blur();
            }
          }}
        />
        <kbd className="rounded-[4px] px-1 text-[11px] text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]">⌘K</kbd>
      </label>
      {open && matches.length > 0 ? (
        <ul
          id="dash-search-results"
          role="listbox"
          className="absolute top-10 right-0 z-50 grid w-80 gap-0.5 rounded-[10px] bg-card p-1 shadow-[var(--float)]"
        >
          {matches.map((item, i) => (
            <li key={item.href} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => go(item.href)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "grid w-full rounded-[6px] px-2.5 py-1.5 text-left text-[14px]",
                  i === active && "bg-foreground/[0.05]",
                )}
              >
                <span className="truncate text-foreground">{item.label}</span>
                {item.detail ? <span className="truncate text-xs text-muted-foreground">{item.detail}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// A sidebar item, raised when it is the page you are on.
export function navItemClass(active: boolean) {
  return cn(
    "flex items-center gap-2.5 rounded-[6px] px-2.5 py-[7px] text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
    active ? "raised text-foreground" : "hover:bg-foreground/[0.04]",
  );
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((word) => word[0] ?? "")
      .join("")
      .slice(0, 2) || "?"
  );
}
