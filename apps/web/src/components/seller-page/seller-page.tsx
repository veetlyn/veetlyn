import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import { ratingLabel } from "@jendal-workspace/core";

import { formatMinor } from "@/lib/money";
import { daysLabel, FULFILMENT_LABELS, type Fulfilment, priceLabel } from "@/lib/offering-labels";

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

export type SellerPageProduct = { id: string; title: string; description: string; priceMinor: number };

// Structural on purpose: the store host passes the api's /api/store/page payload and the admin preview
// passes the tRPC seller.preview output, so this lists only what the page reads and stays free of server imports.
export type SellerPageContent = {
  name: string;
  product: "services" | "store";
  bio: string;
  currency: string;
  // Base for on-page links: "" on the store host (relative), the absolute public origin in the admin preview.
  pageBase: string;
  departments: { id: string; name: string }[];
  offerings: SellerPageOffering[];
  products: SellerPageProduct[];
  rating: { average: number; count: number } | null;
  reviews: { id: string; rating: number; body: string; reviewerName: string; createdAt: string | Date }[];
  portfolio: { id: string; title: string; url: string; description: string }[];
};

// Full-width rows rather than a card grid: works for any number of peer services, keeps descriptions at a readable
// measure, and gives price, turnaround and the request action their own columns from md up (stacked on phones).
function OfferingRow({
  page,
  offering,
  Heading,
}: {
  page: SellerPageContent;
  offering: SellerPageOffering;
  Heading: "h3" | "h4";
}) {
  return (
    <li className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-8">
      <div className="min-w-0 space-y-1.5">
        <Heading className="text-base font-semibold">{offering.name}</Heading>
        {offering.description ? (
          <p className="max-w-prose text-sm whitespace-pre-line text-muted-foreground">{offering.description}</p>
        ) : null}
        {/* "By people" is the default expectation; only an automated part changes what the client is choosing. */}
        {offering.fulfilment !== "people" ? (
          <p className="text-xs text-muted-foreground">{FULFILMENT_LABELS[offering.fulfilment]}</p>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:min-w-56">
        <div>
          <dt className="text-xs text-muted-foreground">Usually</dt>
          <dd className="font-tabular font-semibold">{priceLabel(offering, page.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Turnaround</dt>
          <dd className="font-tabular">{daysLabel(offering)}</dd>
        </div>
      </dl>
      <a
        href={`${page.pageBase}/request?offering=${offering.id}`}
        aria-label={`Request a quote for ${offering.name}`}
        className={buttonVariants({ variant: "outline", size: "sm", className: "justify-self-start md:justify-self-end" })}
      >
        Request a quote
      </a>
    </li>
  );
}

export default function SellerPage({ page }: { page: SellerPageContent }) {
  const departmentIds = new Set(page.departments.map((department) => department.id));
  const groups = page.departments
    .map((department) => ({
      department,
      offerings: page.offerings.filter((offering) => offering.departmentId === department.id),
    }))
    .filter((group) => group.offerings.length > 0);
  // An offering pointing at a department missing from the list still shows, ungrouped.
  const ungrouped = page.offerings.filter(
    (offering) => offering.departmentId === null || !departmentIds.has(offering.departmentId),
  );

  const portfolio = page.portfolio.length > 0 ? (
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
  ) : null;

  // Order: who the seller is and how to ask, then what can be bought, then supporting work and reviews. The rating
  // lives with the reviews rather than in the hero, so a sandbox/sample record is never the page's lead claim; the
  // review text itself (including any sample disclosure) renders unchanged.
  return (
    <main className="mx-auto w-full max-w-5xl space-y-12 px-4 py-10 md:py-14">
      <header className="grid gap-4">
        <span className="grid size-14 place-items-center rounded-2xl main-surface text-lg font-semibold uppercase" aria-hidden="true">
          {page.name
            .split(/\s+/)
            .map((word) => word[0] ?? "")
            .join("")
            .slice(0, 2)}
        </span>
        <h1 className="font-heading text-4xl md:text-5xl">{page.name}</h1>
        {page.bio ? <p className="max-w-2xl text-lg whitespace-pre-line text-muted-foreground">{page.bio}</p> : null}
        {page.product === "services" ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <a href={`${page.pageBase}/request`} className={buttonVariants({ size: "lg" })}>
              Request a quote
            </a>
            {page.offerings.length > 0 ? (
              <a href="#services-heading" className="text-sm underline underline-offset-4">
                See services
              </a>
            ) : null}
          </div>
        ) : null}
      </header>
      {page.product === "services" ? (
        <section aria-labelledby="services-heading" className="space-y-6">
          <h2 id="services-heading" className="font-heading text-2xl">
            Services
          </h2>
          {page.offerings.length === 0 ? (
            page.products.length === 0 ? (
              <p className="text-muted-foreground">No services listed right now.</p>
            ) : (
              <p className="text-muted-foreground">
                <a href={`${page.pageBase}/request`} className="underline underline-offset-4">
                  Request a quote
                </a>{" "}
                for custom work.
              </p>
            )
          ) : (
            <>
              {groups.map(({ department, offerings }) => (
                <div key={department.id} className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">{department.name}</h3>
                  <ul className="panel divide-y overflow-hidden">
                    {offerings.map((offering) => (
                      <OfferingRow key={offering.id} page={page} offering={offering} Heading="h4" />
                    ))}
                  </ul>
                </div>
              ))}
              {ungrouped.length > 0 ? (
                <ul className="panel divide-y overflow-hidden">
                  {ungrouped.map((offering) => (
                    <OfferingRow key={offering.id} page={page} offering={offering} Heading="h3" />
                  ))}
                </ul>
              ) : null}
              <p className="text-sm text-muted-foreground">
                Looking for something else?{" "}
                <a href={`${page.pageBase}/request`} className="underline underline-offset-4">
                  Request a quote
                </a>
              </p>
            </>
          )}
        </section>
      ) : null}
      {page.products.length > 0 ? (
        <section aria-labelledby="store-heading" className="space-y-6">
          <h2 id="store-heading" className="font-heading text-2xl">
            Store
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {page.products.map((product) => (
              <article key={product.id} className="panel grid content-start gap-3 p-5">
                <h3 className="text-base font-semibold">{product.title}</h3>
                {product.description ? <p className="text-sm whitespace-pre-line text-muted-foreground">{product.description}</p> : null}
                <p className="font-tabular text-lg font-semibold">{formatMinor(product.priceMinor, page.currency)}</p>
                <a
                  href={`${page.pageBase}/buy/${product.id}`}
                  aria-label={`Buy ${product.title}`}
                  className={buttonVariants({ variant: "outline", size: "sm", className: "justify-self-start" })}
                >
                  Buy
                </a>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {portfolio}
      {page.reviews.length > 0 ? (
        <section id="reviews" aria-labelledby="reviews-heading" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="reviews-heading" className="font-heading text-2xl">Client reviews</h2>
            {page.rating ? <p className="font-tabular text-sm text-muted-foreground">{ratingLabel(page.rating)}</p> : null}
          </div>
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
