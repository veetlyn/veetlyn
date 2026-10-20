"use client";

import { usePathname } from "next/navigation";
import { type RefObject, useEffect } from "react";

// The header's <details> menus: one open at a time, closed by a click outside, by Escape (focus back on its
// summary) and after a navigation. The header also sticks just below the sandbox banner, whatever its height.
export function useHeaderMenus(header: RefObject<HTMLElement | null>) {
  const pathname = usePathname();

  useEffect(() => {
    for (const d of header.current?.querySelectorAll("details") ?? []) d.open = false;
  }, [header, pathname]);

  useEffect(() => {
    const menus = () => [...(header.current?.querySelectorAll("details") ?? [])];
    const onClick = (e: MouseEvent) => {
      for (const d of menus()) if (d.open && !(e.target instanceof Node && d.contains(e.target))) d.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      for (const d of menus()) {
        if (!d.open) continue;
        d.open = false;
        d.querySelector("summary")?.focus();
      }
    };
    const onToggle = (e: Event) => {
      const opened = e.target;
      if (!(opened instanceof HTMLDetailsElement) || !opened.open) return;
      for (const d of menus()) if (d !== opened) d.open = false;
    };
    const el = header.current;
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    el?.addEventListener("toggle", onToggle, true);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      el?.removeEventListener("toggle", onToggle, true);
    };
  }, [header]);

  useEffect(() => {
    const banner = document.querySelector<HTMLElement>('aside[aria-label="Sandbox notice"]');
    const el = header.current;
    if (!banner || !el) return;
    const sync = () => el.style.setProperty("--banner-h", `${banner.offsetHeight}px`);
    const ro = new ResizeObserver(sync);
    ro.observe(banner);
    sync();
    return () => ro.disconnect();
  }, [header]);

  return pathname;
}
