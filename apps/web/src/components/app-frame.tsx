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
import { ChevronsUpDown, Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { BrandWordmark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";

export type CrumbOption = { href: string; label: string; detail?: string };
// A crumb with options is a switcher: its menu lists the places at the same level. Crumbs whose choices the sidebar
// already lists stay plain links.
export type Crumb = { href: string; label: string; options?: CrumbOption[]; menuLabel?: string; kind?: "workspace" | "seller" };
export type SearchItem = { href: string; label: string; detail?: string };
const MOBILE_NAV_QUERY = "(width < 48rem)";

// The dash frame at every level of the context tree: the node's sidebar on the tray, the page on a framed canvas with
// the breadcrumb and search on top. Only the canvas scrolls.
export default function AppFrame({
  sidebar,
  crumbs,
  searchItems = [],
  banner,
  fill = false,
  children,
}: {
  sidebar: React.ReactNode;
  crumbs: Crumb[];
  searchItems?: SearchItem[];
  banner?: React.ReactNode;
  // A conversation holds its own scrolling: it takes the height left under the banners.
  fill?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [mobile, setMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_NAV_QUERY);
    const sync = () => {
      setMobile(media.matches);
      if (!media.matches) drawer.current?.close();
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    drawer.current?.close();
  }, [pathname]);

  const navigation = <>
    <Link href="/" className="mb-2 flex h-10 shrink-0 items-center px-2.5">
      <BrandWordmark className="font-heading text-[18px] text-foreground" />
      <span className="sr-only">Your account</span>
    </Link>
    {sidebar}
    <div className="mt-auto pt-6"><UserMenu sidebar drawer={mobile} /></div>
  </>;

  return (
    <div
      data-app-shell
      className={cn("grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] bg-tray", "md:grid-cols-[280px_minmax(0,1fr)]")}
    >
      {!mobile ? <aside data-scroll className="hidden min-h-0 min-w-0 flex-col gap-0.5 overflow-y-auto px-2 pt-2 pb-2 md:flex">{navigation}</aside> : null}

      {mobile ? <dialog
        ref={drawer}
        id="navigation-drawer"
        data-navigation-drawer
        aria-labelledby="navigation-drawer-title"
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(85vw,320px)] max-w-none bg-card p-0 text-foreground backdrop:bg-black/35"
        onClose={() => {
          setDrawerOpen(false);
          if (window.matchMedia(MOBILE_NAV_QUERY).matches) menuButton.current?.focus();
        }}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
          if (outside || (event.target instanceof Element && event.target.closest("a[href]"))) event.currentTarget.close();
        }}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
            <h2 id="navigation-drawer-title" className="text-sm font-semibold">Navigation</h2>
            <button type="button" onClick={() => drawer.current?.close()} aria-label="Close navigation" className="flex size-11 items-center justify-center rounded-lg hover:bg-accent"><X className="size-5" aria-hidden="true" /></button>
          </div>
          <div data-scroll className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-2 py-3">{navigation}</div>
        </div>
      </dialog> : null}

      <div className="flex min-h-0 min-w-0 flex-col bg-card md:my-2 md:mr-2 md:frame md:rounded-[10px]">
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b px-4 md:px-5">
          <button
            ref={menuButton}
            type="button"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls="navigation-drawer"
            className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-accent md:hidden"
            onClick={() => { drawer.current?.showModal(); setDrawerOpen(true); }}
          ><Menu className="size-5" aria-hidden="true" /></button>
          <Link href="/" className="md:hidden">
            <BrandWordmark className="font-heading text-[16px]" />
            <span className="sr-only">Your account</span>
          </Link>
          <Breadcrumb crumbs={crumbs} />
          <div className="ml-auto flex items-center gap-2">
            <SearchBar items={searchItems} />
            <ModeToggle />
          </div>
        </div>
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
            {i > 0 ? <span className="hidden px-1 text-muted-foreground/40 md:block" aria-hidden="true">/</span> : null}
            {crumb.options && crumb.options.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    "flex min-w-0 items-center gap-1 rounded-[6px] px-1.5 py-1 hover:bg-foreground/[0.05] hover:text-foreground",
                    last && "font-medium text-foreground",
                  )}
                  aria-label={`${crumb.label}. Switch ${crumb.menuLabel ?? "place"}`}
                >
                  {crumb.kind ? <span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded-[4px] text-[10px] font-semibold", crumb.kind === "workspace" ? "bg-foreground text-background" : "bg-secondary text-foreground")}>{initialsOf(crumb.label)}</span> : null}
                  <span className="truncate">{crumb.label}</span>
                  <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
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
    "flex items-center gap-2.5 rounded-[6px] px-2.5 py-[7px] text-[14px] font-medium text-foreground [&_svg:first-child]:size-[18px]",
    active ? "raised" : "hover:bg-foreground/[0.04]",
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
