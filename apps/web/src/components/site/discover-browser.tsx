"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

import MemberCheck from "@/components/site/member-check";
import { DONE_LABEL, KIND_LABEL, type Listing, SAMPLE_LISTINGS } from "@/content/site/listings";
import { browse, type Filters } from "@/lib/site/discover";

const CATEGORIES = [
  ["all", "All"],
  ["design", "Design"],
  ["development", "Development"],
  ["writing", "Writing"],
  ["video", "Video and audio"],
  ["courses", "Courses"],
  ["templates", "Templates"],
  ["beauty", "Beauty and wellness"],
  ["goods", "Goods"],
] as const satisfies ReadonlyArray<readonly [NonNullable<Filters["category"]>, string]>;
const TYPES = [
  ["all", "Any"],
  ["service", "Services"],
  ["download", "Downloads"],
  ["course", "Courses"],
  ["product", "Goods"],
] as const satisfies ReadonlyArray<readonly [NonNullable<Filters["type"]>, string]>;
const DONE_BY = [
  ["all", "Anyone"],
  ["people", "People"],
  ["both", "People with AI"],
  ["ai", "AI"],
] as const satisfies ReadonlyArray<readonly [NonNullable<Filters["done"]>, string]>;
const SORTS = [
  ["featured", "Featured"],
  ["price", "Lowest price"],
] as const satisfies ReadonlyArray<readonly [NonNullable<Filters["sort"]>, string]>;

const MEMBERS = SAMPLE_LISTINGS.filter((l) => l.member).slice(0, 4);

function Card({ item }: { item: Listing }) {
  return (
    <article className="item-card">
      <div className={`cover tone-${item.tone}`} aria-hidden="true">
        <span className="kind">{KIND_LABEL[item.kind]}</span>
        <span className="glyph">{item.glyph}</span>
      </div>
      <div className="item-body">
        <p className="item-title">{item.title}</p>
        <p className="seller">
          {item.seller}
          {item.member && <MemberCheck />}
        </p>
        <p className="item-meta">
          {DONE_LABEL[item.done]} · {item.detail}
        </p>
        <p className="item-price num">{item.priceLabel}</p>
      </div>
    </article>
  );
}

function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
  title,
}: {
  label: string;
  options: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange: (v: T) => void;
  className: string;
  title?: string;
}) {
  return (
    <div className={className} role="group" aria-label={label}>
      {title && <span>{title}</span>}
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

// Discover's search, filters and grid over the sample listings. The search box reads ?q= on arrival, which is
// where the site's WebSite SearchAction points.
export default function DiscoverBrowser({ children }: { children: ReactNode }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<NonNullable<Filters["category"]>>("all");
  const [type, setType] = useState<NonNullable<Filters["type"]>>("all");
  const [done, setDone] = useState<NonNullable<Filters["done"]>>("all");
  const [sort, setSort] = useState<NonNullable<Filters["sort"]>>("featured");

  useEffect(() => {
    setQ(new URLSearchParams(window.location.search).get("q") ?? "");
  }, []);

  const shown = browse(SAMPLE_LISTINGS, { q, category, type, done, sort });

  return (
    <>
      <div className="band">
        <div className="wrap hero page solo">
          <div>
            <h1 data-in>Discover</h1>
            <p className="lead" data-in>
              Services, courses, downloads and goods from sellers on Payleor Network. The same catalog your clients' AI
              searches.
            </p>
            <label className="search" data-in>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className="sr-only">Search Discover</span>
              <input
                type="search"
                placeholder="A logo, a pedicure, a Notion template..."
                autoComplete="off"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
          </div>
        </div>
      </div>
      <div>
        <section aria-label="Filters" style={{ paddingTop: "clamp(36px,5vw,56px)" }}>
          <div className="wrap">
            <Choices className="tabs-row" label="Category" options={CATEGORIES} value={category} onChange={setCategory} />
            <div className="filters">
              <Choices className="chips" label="Type" title="Type" options={TYPES} value={type} onChange={setType} />
              <Choices
                className="chips"
                label="Who does the work"
                title="Done by"
                options={DONE_BY}
                value={done}
                onChange={setDone}
              />
              <Choices className="chips" label="Sort" title="Sort" options={SORTS} value={sort} onChange={setSort} />
            </div>
          </div>
        </section>
        <section aria-labelledby="members-h" style={{ paddingTop: "48px" }}>
          <div className="wrap">
            <h2 id="members-h" data-in>
              Network members
            </h2>
            <p className="lead-dark" data-in>
              Sellers with the member check.{" "}
              <Link className="link" href="/network#membership">
                What membership means
              </Link>
            </p>
            <div className="shelf">
              {MEMBERS.map((item) => (
                <Card key={item.title} item={item} />
              ))}
            </div>
          </div>
        </section>
        <section aria-labelledby="all-h" style={{ paddingTop: "64px" }}>
          <div className="wrap">
            <h2 id="all-h" data-in>
              Everything on the network
            </h2>
            <div className="result-bar">
              <span aria-live="polite">
                {shown.length} {shown.length === 1 ? "listing" : "listings"}
              </span>
              <span>Sample listings while the network opens</span>
            </div>
            <div className="items">
              {shown.map((item) => (
                <Card key={item.title} item={item} />
              ))}
            </div>
            <p className="empty" hidden={shown.length > 0}>
              Nothing matches yet. Try another word or clear a filter.
            </p>
          </div>
        </section>
        {children}
      </div>
    </>
  );
}
