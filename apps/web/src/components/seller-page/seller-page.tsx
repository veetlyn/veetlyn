import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";

import { formatMinor } from "@/lib/money";
import { daysLabel, priceLabel } from "@/lib/offering-labels";

type SellerPageOffering = {
  id: string;
  departmentId: string | null;
  name: string;
  description: string;
  priceMinMinor: number;
  priceMaxMinor: number;
  daysMin: number;
  daysMax: number;
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
};

function OfferingCard({
  page,
  offering,
  Heading,
}: {
  page: SellerPageContent;
  offering: SellerPageOffering;
  Heading: "h3" | "h4";
}) {
  return (
    <article className="panel grid content-start gap-3 p-5">
      <Heading className="text-base font-semibold">{offering.name}</Heading>
      {offering.description ? (
        <p className="text-sm whitespace-pre-line text-muted-foreground">{offering.description}</p>
      ) : null}
      <p className="text-sm">
        <span className="text-muted-foreground">Usually </span>
        <span className="font-tabular font-semibold">{priceLabel(offering, page.currency)}</span>
        <span className="text-muted-foreground"> · {daysLabel(offering)}</span>
      </p>
      <a
        href={`${page.pageBase}/request?offering=${offering.id}`}
        aria-label={`Request a quote for ${offering.name}`}
        className={buttonVariants({ variant: "outline", size: "sm", className: "justify-self-start" })}
      >
        Request a quote
      </a>
    </article>
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

  return (
    <main className="mx-auto w-full max-w-5xl space-y-12 px-4 py-10 md:py-14">
      <header className="grid gap-4">
        <span className="grid size-14 place-items-center rounded-2xl main-surface font-tabular text-lg font-bold uppercase">
          {page.name
            .split(/\s+/)
            .map((word) => word[0] ?? "")
            .join("")
            .slice(0, 2)}
        </span>
        <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-5xl">{page.name}</h1>
        {page.bio ? <p className="max-w-2xl text-lg whitespace-pre-line text-muted-foreground">{page.bio}</p> : null}
        {page.product === "services" ? (
          <a href={`${page.pageBase}/request`} className={buttonVariants({ size: "lg", className: "justify-self-start" })}>
            Request a quote
          </a>
        ) : null}
      </header>
      {page.product === "services" ? (
        <section aria-labelledby="services-heading" className="space-y-6">
          <h2 id="services-heading" className="font-[family-name:var(--font-display)] text-2xl">
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
                  <div className="grid gap-3 md:grid-cols-2">
                    {offerings.map((offering) => (
                      <OfferingCard key={offering.id} page={page} offering={offering} Heading="h4" />
                    ))}
                  </div>
                </div>
              ))}
              {ungrouped.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {ungrouped.map((offering) => (
                    <OfferingCard key={offering.id} page={page} offering={offering} Heading="h3" />
                  ))}
                </div>
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
          <h2 id="store-heading" className="font-[family-name:var(--font-display)] text-2xl">
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
    </main>
  );
}
