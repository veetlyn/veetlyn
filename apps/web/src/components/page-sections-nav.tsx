"use client";

import { cn } from "@jendal-workspace/ui/lib/utils";
import { useEffect, useState } from "react";

export type PageSection = { id: string; label: string; children?: { id: string; label: string }[] };

// The section in view: the first one, in page order, whose top has reached the upper part of the screen.
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join(" ");
  useEffect(() => {
    const order = key.split(" ");
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = order.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: "-15% 0px -65% 0px" },
    );
    for (const id of order) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [key]);
  return active;
}

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ block: "start" });
}

// A page's sections: a sticky list beside the content on wide screens, a sticky row of chips above it otherwise.
export function PageSectionsRail({ sections }: { sections: PageSection[] }) {
  const ids = sections.flatMap((section) => [section.id, ...(section.children ?? []).map((child) => child.id)]);
  const active = useActiveSection(ids);
  const activeTop = sections.find((section) => section.id === active || section.children?.some((child) => child.id === active))?.id;

  const link = (id: string, label: string, nested: boolean) => (
    <a
      key={id}
      href={`#${id}`}
      aria-current={active === id ? "location" : undefined}
      onClick={(event) => {
        event.preventDefault();
        jumpTo(id);
      }}
      className={cn(
        "block rounded-md py-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
        nested ? "pl-5 text-[13px]" : "px-2 font-medium",
        "aria-[current=location]:text-foreground",
        !nested && "aria-[current=location]:bg-accent",
      )}
    >
      {label}
    </a>
  );

  return (
    <>
      <nav
        aria-label="On this page"
        className="sticky top-0 z-10 -mx-4 flex gap-1 overflow-x-auto border-b bg-background/95 px-4 py-2 backdrop-blur md:-mx-7 md:px-7 lg:hidden"
      >
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-current={activeTop === section.id ? "location" : undefined}
            onClick={(event) => {
              event.preventDefault();
              jumpTo(section.id);
            }}
            className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground aria-[current=location]:bg-card aria-[current=location]:text-foreground aria-[current=location]:shadow-[0_0_0_1px_var(--input)]"
          >
            {section.label}
          </a>
        ))}
      </nav>
      <nav aria-label="On this page" className="sticky top-8 hidden max-h-[calc(100svh-8rem)] self-start overflow-y-auto lg:col-start-2 lg:row-start-1 lg:block">
        <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">On this page</p>
        <div className="grid gap-0.5">
          {sections.map((section) => (
            <div key={section.id}>
              {link(section.id, section.label, false)}
              {section.children && activeTop === section.id ? (
                <div className="mt-0.5 mb-1 ml-2 grid border-l">{section.children.map((child) => link(child.id, child.label, true))}</div>
              ) : null}
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
