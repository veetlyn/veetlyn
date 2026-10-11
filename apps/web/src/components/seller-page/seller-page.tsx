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
    <article className="border p-4 grid gap-2">
      <Heading className="font-medium">{offering.name}</Heading>
      {offering.description ? (
        <p className="whitespace-pre-line">{offering.description}</p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Usually {priceLabel(offering, page.currency)} · {daysLabel(offering)}
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
    <main className="container mx-auto max-w-3xl px-4 py-10 space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">{page.name}</h1>
        {page.bio ? <p className="text-muted-foreground whitespace-pre-line">{page.bio}</p> : null}
      </header>
      {page.product === "services" ? (
        <section aria-labelledby="services-heading" className="space-y-6">
          <h2 id="services-heading" className="text-xl font-semibold">
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
                  <h3 className="text-lg font-medium">{department.name}</h3>
                  {offerings.map((offering) => (
                    <OfferingCard key={offering.id} page={page} offering={offering} Heading="h4" />
                  ))}
                </div>
              ))}
              {ungrouped.length > 0 ? (
                <div className="space-y-3">
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
          <h2 id="store-heading" className="text-xl font-semibold">
            Store
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {page.products.map((product) => (
              <article key={product.id} className="border p-4 grid gap-2">
                <h3 className="font-medium">{product.title}</h3>
                {product.description ? <p className="whitespace-pre-line">{product.description}</p> : null}
                <p className="text-sm text-muted-foreground">{formatMinor(product.priceMinor, page.currency)}</p>
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
