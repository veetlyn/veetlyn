"use client";

import Link from "next/link";
import { useRef } from "react";

import { BrandMark } from "@/components/brand-mark";
import { usePlatformName } from "@/components/platform-name";
import ArticleArt from "@/components/site/art/article";
import MiniArt from "@/components/site/art/mini";
import {
  AUDIENCE_FEATURE,
  AUDIENCE_MENU,
  type MenuEntry,
  type MenuFeature,
  networkFeature,
  networkMenu,
  TOP_LINKS,
} from "@/content/site/nav";

import { useHeaderMenus } from "./mega-menu";

const current = (pathname: string, path: string) => (pathname === path ? "page" : undefined);

function Tile({ entry, pathname, className }: { entry: MenuEntry; pathname: string; className: string }) {
  return (
    <Link className={className} href={entry.path} aria-current={current(pathname, entry.path)}>
      <span className="mega-art">
        <MiniArt name={entry.art} />
      </span>
      <span className="mega-txt">
        <b>{entry.label}</b>
        <small>{entry.tagline}</small>
      </span>
    </Link>
  );
}

function Drop({
  label,
  entries,
  feature,
  pathname,
}: {
  label: string;
  entries: readonly MenuEntry[];
  feature: MenuFeature;
  pathname: string;
}) {
  const here = entries.some((e) => e.path === pathname);
  return (
    <details className={`drop nav-item${here ? " current" : ""}`}>
      <summary>{label}</summary>
      <div className="mega">
        {entries.map((e) => (
          <Tile key={e.path} entry={e} pathname={pathname} className="mega-item" />
        ))}
        <Link className="mega-feature" href={feature.path}>
          <span className="art">
            {feature.art === "gap" ? <ArticleArt name="gap" /> : <MiniArt name={feature.art} />}
          </span>
          <b>{feature.title}</b>
          <small>{feature.text}</small>
          <span className="go">{feature.go}</span>
        </Link>
      </div>
    </details>
  );
}

export default function SiteHeader({ dashOrigin, waitlistOnly = false }: { dashOrigin: string; waitlistOnly?: boolean }) {
  const header = useRef<HTMLElement>(null);
  const pathname = useHeaderMenus(header);
  const name = usePlatformName();
  const netMenu = networkMenu(name);
  const netFeature = networkFeature(name);
  return (
    <header className="top band" ref={header}>
      <div className="wrap">
        <Link className="mark" href="/" aria-label={`${name} home`}>
          <BrandMark />
          {name}
        </Link>
        <nav className="links" aria-label="Main">
          <Drop label="Network" entries={netMenu} feature={netFeature} pathname={pathname} />
          <Drop label="Who it is for" entries={AUDIENCE_MENU} feature={AUDIENCE_FEATURE} pathname={pathname} />
          {TOP_LINKS.map((l) => (
            <Link key={l.path} className="nav-item" href={l.path} aria-current={current(pathname, l.path)}>
              {l.label}
            </Link>
          ))}
          {!waitlistOnly && <a className="nav-item" href={`${dashOrigin}/login`}>Log in</a>}
          <details className="menu">
            <summary>Menu</summary>
            <div className="menu-panel">
              <p className="menu-h">Network</p>
              <div className="menu-grid">
                {netMenu.map((e) => (
                  <Tile key={e.path} entry={e} pathname={pathname} className="menu-tile" />
                ))}
              </div>
              <p className="menu-h">Who it is for</p>
              <div className="menu-grid">
                {AUDIENCE_MENU.map((e) => (
                  <Tile key={e.path} entry={e} pathname={pathname} className="menu-tile" />
                ))}
              </div>
              <div className="menu-links">
                {TOP_LINKS.map((l) => (
                  <Link key={l.path} className="menu-link" href={l.path} aria-current={current(pathname, l.path)}>
                    {l.label}
                  </Link>
                ))}
                {!waitlistOnly && <a className="menu-link" href={`${dashOrigin}/login`}>Log in</a>}
              </div>
            </div>
          </details>
          <a className="btn btn-mint" href={waitlistOnly ? "/waitlist" : `${dashOrigin}/signup`}>
            {waitlistOnly ? "Join the waitlist" : "Get started"}
          </a>
        </nav>
      </div>
    </header>
  );
}
