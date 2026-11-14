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
import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@jendal-workspace/ui/components/motion/breadcrumb";
import { CommandPalette, type CommandItem } from "@jendal-workspace/ui/components/motion/command-palette";
import { Tabs, TabsList, TabsTrigger } from "@jendal-workspace/ui/components/motion/tabs";
import { ChevronsUpDown, Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";

export type CrumbOption = { href: string; label: string; detail?: string };
// A crumb with options is a switcher: its menu lists the places at the same level. Crumbs whose choices the sidebar
// already lists stay plain links.
export type Crumb = { href: string; label: string; options?: CrumbOption[]; menuLabel?: string; kind?: "workspace" | "seller" };
export type SearchItem = { href: string; label: string; detail?: string; group?: string };
const MOBILE_NAV_QUERY = "(width < 48rem)";

// The dash frame at every level of the context tree: the node's sidebar on the tray, the page on a framed canvas with
// the breadcrumb and search on top. Only the canvas scrolls.
export default function AppFrame({
  sidebar,
  workspace,
  crumbs,
  searchItems = [],
  tabs,
  activeTab,
  banner,
  fill = false,
  children,
}: {
  sidebar: React.ReactNode;
  workspace?: Crumb & { detail?: string };
  crumbs: Crumb[];
  searchItems?: SearchItem[];
  /** The current place's pages, shown on the top bar in place of the breadcrumb. */
  tabs?: { href: string; label: string }[];
  activeTab?: string;
  banner?: React.ReactNode;
  // A conversation holds its own scrolling: it takes the height left under the banners.
  fill?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
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
    {workspace ? <WorkspaceSwitcher workspace={workspace} mobile={mobile} /> : null}
    {sidebar}
    <div className="mt-auto pt-6"><UserMenu sidebar drawer={mobile} /></div>
  </>;

  return (
    <div
      data-app-shell
      data-fill={fill ? "" : undefined}
      // The page scrolls the document, so the main surface is as tall as its content; the sidebar stays pinned at the
      // viewport's height. A fill page (a thread with its composer) is held to the viewport instead.
      className={cn("grid flex-1 grid-cols-[minmax(0,1fr)] items-start bg-background", "md:grid-cols-[256px_minmax(0,1fr)]", fill && "h-svh min-h-0 items-stretch")}
    >
      {!mobile ? <aside data-scroll className="sticky top-0 hidden h-svh min-h-0 min-w-0 flex-col gap-0.5 overflow-y-auto px-3 pt-2 pb-3 md:flex">{navigation}</aside> : null}

      {mobile ? <dialog
        ref={drawer}
        id="navigation-drawer"
        data-navigation-drawer
        aria-labelledby="navigation-drawer-title"
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(85vw,320px)] max-w-none bg-background p-0 text-foreground backdrop:bg-black/35"
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

      <div className={cn("flex min-w-0 flex-col bg-card md:border-l", fill ? "min-h-0 md:h-svh" : "min-h-svh")}>
        <div className="sticky top-0 z-20 flex h-[52px] shrink-0 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur-md md:px-5">
          <button
            ref={menuButton}
            type="button"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls="navigation-drawer"
            className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-accent md:hidden"
            onClick={() => { drawer.current?.showModal(); setDrawerOpen(true); }}
          ><Menu className="size-5" aria-hidden="true" /></button>
          {tabs ? (
            <Tabs value={activeTab} onValueChange={(href) => router.push(href)} variant="underline" className="flex min-w-0 self-stretch">
              <TabsList aria-label="Pages in this place" wrapperClassName="self-stretch [&>div]:h-full" className="h-full border-b-0">
                {tabs.map((tab) => <TabsTrigger key={tab.href} value={tab.href} onMouseEnter={() => router.prefetch(tab.href)} className="min-h-0 h-full px-2.5 pt-0 pb-0 text-[13px]" indicatorClassName="bg-foreground">{tab.label}</TabsTrigger>)}
              </TabsList>
            </Tabs>
          ) : <Crumbs crumbs={crumbs} />}
          <div className="ml-auto flex items-center gap-2">
            <SearchBar items={searchItems} />
            <ModeToggle />
          </div>
        </div>
        <div
          id="page-scroll"
          data-scroll={fill ? "" : undefined}
          className={cn(
            "flex-1",
            fill && "flex min-h-0 flex-col overflow-hidden",
          )}
        >
          {banner}
          {children}
        </div>
      </div>
    </div>
  );
}

function WorkspaceSwitcher({ workspace, mobile }: { workspace: Crumb & { detail?: string }; mobile: boolean }) {
  const router = useRouter();
  const options = workspace.options ?? [];
  const choices = options.some((option) => option.href === workspace.href)
    ? options
    : [{ href: workspace.href, label: workspace.label, detail: workspace.detail }, ...options];
  // Native selection stays inside the modal navigation drawer; a body-portalled menu is inert behind it.
  if (mobile) return (
    <label className="mb-5 grid gap-2 px-2">
      <span className="text-xs text-muted-foreground">Workspace</span>
      <select aria-label="Switch workspace" className={cn(nativeSelectClass, "h-11 w-full max-w-full")} value={workspace.href} onChange={(event) => router.push(event.target.value)}>
        {choices.map((option) => <option key={option.href} value={option.href}>{option.label}{option.detail ? ` · ${option.detail}` : ""}</option>)}
        <optgroup label="New workspace"><option value="/new/services-team">New services team</option><option value="/new">New store</option></optgroup>
      </select>
    </label>
  );
  return (
    <DropdownMenu>
      {/* As tall as the page's top bar, so the two line up across the frame. */}
      <DropdownMenuTrigger className="mb-3 flex h-[52px] w-full shrink-0 items-center gap-3 rounded-[10px] px-2 text-left transition-colors duration-150 outline-none hover:bg-foreground/[0.04] focus-visible:outline-2 focus-visible:outline-ring data-popup-open:bg-foreground/[0.05]" aria-label={`Workspace: ${workspace.label}. Switch workspace`}>
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-foreground text-[12px] font-medium text-background">{initialsOf(workspace.label)}</span>
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-[14px] font-medium">{workspace.label}</span>
          {workspace.detail ? <span className="truncate text-[12px] text-muted-foreground">{workspace.detail}</span> : null}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[70dvh] w-64 overflow-y-auto bg-card" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
          {choices.map((option) => <DropdownMenuItem key={option.href} render={<Link href={option.href} />}><span className="grid min-w-0"><span className={cn("truncate", option.href === workspace.href && "font-semibold")}>{option.label}</span>{option.detail ? <span className="text-xs text-muted-foreground">{option.detail}</span> : null}</span></DropdownMenuItem>)}
        </DropdownMenuGroup>
        <DropdownMenuGroup>
          <DropdownMenuLabel>New workspace</DropdownMenuLabel>
          <DropdownMenuItem render={<Link href="/new/services-team" />}>New services team</DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/new" />}>New store</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Crumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    // beUI's breadcrumb primitives; a crumb with choices keeps our dropdown as its switcher.
    // A lone crumb only repeats the page title; pages with a PageHeader hide it (dash.css).
    <Breadcrumb labels={{ label: "Breadcrumb" }} className="min-w-0" data-lone-crumb={crumbs.length === 1 && !(crumbs[0]?.options && crumbs[0].options.length > 1) ? "" : undefined}>
      <BreadcrumbList maxItems={Infinity} className="flex-nowrap text-[14px]">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <BreadcrumbItem key={`${crumb.href}-${i}`} className={cn(!last && "hidden md:inline-flex")}>
              {i > 0 ? <BreadcrumbSeparator className="hidden md:inline-flex" /> : null}
              {crumb.options && crumb.options.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(
                      "inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-md px-2 font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      last && "text-foreground",
                    )}
                    aria-label={`${crumb.label}. Switch ${crumb.menuLabel ?? "place"}`}
                    aria-current={last ? "page" : undefined}
                  >
                    {crumb.kind ? <span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded-[4px] text-[9px] font-semibold", crumb.kind === "workspace" ? "bg-foreground text-background" : "bg-secondary text-foreground")}>{initialsOf(crumb.label)}</span> : null}
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
                <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink href={crumb.href} className="truncate" render={(props) => <Link {...props} href={crumb.href} />}>
                  {crumb.label}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

// Search in the top bar: beUI's command palette over every page and place at this node. ⌘K or Ctrl K opens it from
// anywhere; the field-shaped key opens it too, and closing returns focus to that key.
function SearchBar({ items }: { items: SearchItem[] }) {
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const commands = useMemo<CommandItem[]>(() => {
    const seen = new Set<string>();
    return items
      .filter((item) => !seen.has(item.href) && seen.add(item.href))
      .map((item) => ({
        id: item.href,
        label: item.label,
        group: item.group ?? "Pages",
        keywords: item.detail ? [item.detail] : undefined,
        badge: item.detail ? <span className="max-w-48 truncate text-xs text-muted-foreground">{item.detail}</span> : undefined,
        onSelect: () => router.push(item.href),
      }));
  }, [items, router]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="hidden h-8 w-64 items-center gap-2 rounded-[6px] bg-foreground/[0.04] px-2.5 text-left text-[13px] text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:text-foreground lg:flex"
      >
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Search pages and places</span>
        <kbd className="rounded-[4px] px-1 text-[12px] shadow-[inset_0_0_0_1px_var(--border)]">⌘K</kbd>
      </button>
      <CommandPalette
        items={commands}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
        }}
        placeholder="Search pages and places"
        emptyMessage="Nothing here matches."
        labels={{ dialog: "Search", list: "Pages and places", close: "Close search" }}
      />
    </>
  );
}

// A sidebar item: 16px icon, 15px label in the default grey; the page you are on takes the neutral selected fill and
// strong ink.
export function navItemClass(active: boolean) {
  return cn(
    "flex items-center gap-3 rounded-[8px] px-3 py-2 text-[15px] transition-colors duration-150 ease-out [&_svg:first-child]:size-4",
    active ? "selected-fill font-medium [&_svg_[fill]]:fill-current" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
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
