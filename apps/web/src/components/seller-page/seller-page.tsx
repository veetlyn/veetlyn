import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import { ratingLabel } from "@jendal-workspace/core";

import { flattenCategories } from "@/lib/catalog-categories";
import { formatMinor } from "@/lib/money";
import { daysLabel, FULFILMENT_LABELS, type Fulfilment, priceLabel } from "@/lib/offering-labels";

import { type CatalogEntry, SellerCatalog } from "./seller-catalog";

type SellerPageOffering = {
  id: string;
  departmentId: string | null;
  name: string;
  description: string;
  priceMinMinor: number;
  priceMaxMinor: number;
  daysMin: number;
  daysMax: number;
  fulfilment: Fulfilment;
};

export type SellerPageProduct = { id: string; departmentId: string | null; title: string; description: string; priceMinor: number };

// Structural on purpose: the store host passes the api's /api/store/page payload and the admin preview
// passes the tRPC seller.preview output, so this lists only what the page reads and stays free of server imports.
export type SellerPageContent = {
  name: string;
  product: "services" | "store";
  bio: string;
  currency: string;
  // Base for on-page links: "" on the store host (relative), the absolute public origin in the admin preview.
  pageBase: string;
  departments: { id: string; name: string; parentId: string | null }[];
  offerings: SellerPageOffering[];
  products: SellerPageProduct[];
  rating: { average: number; count: number } | null;
  reviews: { id: string; rating: number; body: string; reviewerName: string; createdAt: string | Date }[];
  portfolio: { id: string; title: string; url: string; description: string }[];
};

export default function SellerPage({ page }: { page: SellerPageContent }) {
  const categories = flattenCategories(page.departments).map((department) => ({ id: department.id, path: department.path }));
  const services: CatalogEntry[] = page.offerings.map((offering) => ({
    id: offering.id,
    categoryId: offering.departmentId,
    title: offering.name,
    description: offering.description,
    price: `Usually ${priceLabel(offering, page.currency)}`,
    meta: `${daysLabel(offering)} · ${FULFILMENT_LABELS[offering.fulfilment]}`,
    href: `${page.pageBase}/request?offering=${offering.id}`,
    action: "Request a quote",
    actionLabel: `Request a quote for ${offering.name}`,
  }));
  const items: CatalogEntry[] = page.products.map((product) => ({
    id: product.id,
    categoryId: product.departmentId,
    title: product.title,
    description: product.description,
    price: formatMinor(product.priceMinor, page.currency),
    href: `${page.pageBase}/buy/${product.id}`,
    action: "Buy",
    actionLabel: `Buy ${product.title}`,
  }));
  return (
    <main className="mx-auto w-full max-w-5xl space-y-12 px-4 py-10 md:py-14">
      <header className="grid gap-4">
        <span className="grid size-14 place-items-center rounded-2xl main-surface text-lg font-semibold uppercase">
          {page.name
            .split(/\s+/)
            .map((word) => word[0] ?? "")
            .join("")
            .slice(0, 2)}
        </span>
        <h1 className="font-heading text-4xl md:text-5xl">{page.name}</h1>
        {page.rating ? <a href="#reviews" className="w-fit text-sm underline underline-offset-4">{ratingLabel(page.rating)}</a> : null}
        {page.bio ? <p className="max-w-2xl text-lg whitespace-pre-line text-muted-foreground">{page.bio}</p> : null}
        {page.product === "services" ? (
          <a href={`${page.pageBase}/request`} className={buttonVariants({ size: "lg", className: "justify-self-start" })}>
            Request a quote
          </a>
        ) : null}
      </header>
      {page.product === "services" ? (
        page.offerings.length === 0 ? (
          <section aria-labelledby="services-heading" className="space-y-3">
            <h2 id="services-heading" className="font-heading text-2xl">Services</h2>
            {page.products.length === 0 ? (
              <p className="text-muted-foreground">No services listed right now.</p>
            ) : (
              <p className="text-muted-foreground">
                <a href={`${page.pageBase}/request`} className="underline underline-offset-4">Request a quote</a> for custom work.
              </p>
            )}
          </section>
        ) : (
          <SellerCatalog
            id="services"
            title="Services"
            entries={services}
            categories={categories}
            footer={<p className="text-sm text-muted-foreground">Looking for something else? <a href={`${page.pageBase}/request`} className="underline underline-offset-4">Request a quote</a></p>}
          />
        )
      ) : null}
      {items.length > 0 ? <SellerCatalog id="store" title="Premade items" entries={items} categories={categories} /> : null}
      {page.portfolio.length > 0 ? (
        <section aria-labelledby="portfolio-heading" className="space-y-4">
          <h2 id="portfolio-heading" className="font-heading text-2xl">Past work</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {page.portfolio.map((item) => (
              <article key={item.id} className="space-y-2 border-t pt-4">
                <h3 className="font-semibold"><a href={item.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{item.title}</a></h3>
                {item.description ? <p className="whitespace-pre-line text-sm text-muted-foreground">{item.description}</p> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {page.reviews.length > 0 ? (
        <section id="reviews" aria-labelledby="reviews-heading" className="space-y-4">
          <h2 id="reviews-heading" className="font-heading text-2xl">Client reviews</h2>
          <p className="text-sm text-muted-foreground">From clients of completed, paid projects.</p>
          <div className="divide-y">
            {page.reviews.map((review) => (
              <article key={review.id} className="space-y-2 py-4">
                <p className="text-sm"><strong>{review.reviewerName}</strong> · <span aria-label={`${review.rating} out of 5 stars`}>{"★".repeat(review.rating)}</span></p>
                {review.body ? <p className="whitespace-pre-line text-sm">{review.body}</p> : null}
                <p className="text-xs text-muted-foreground"><time dateTime={new Date(review.createdAt).toISOString()}>{new Date(review.createdAt).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}</time></p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
