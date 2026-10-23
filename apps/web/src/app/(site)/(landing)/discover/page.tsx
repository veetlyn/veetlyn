import Link from "next/link";

import CloseCta from "@/components/site/close-cta";
import DiscoverBrowser from "@/components/site/discover-browser";
import JsonLd from "@/components/site/json-ld";
import { platformSite } from "@/lib/platform";
import { PRICE_FACTS } from "@/lib/site/fees";
import { absoluteUrl, breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

export function generateMetadata() {
  const site = platformSite();
  return pageMetadata({
    path: "/discover",
    title: "Discover",
    description: `Browse services, courses, downloads and goods from sellers on ${site.name} Network, the same catalog clients' AI searches in Claude and ChatGPT.`,
    site,
  });
}

export default function DiscoverPage() {
  const site = platformSite();
  return (
    <>
      {/* The listings are samples until the network's search replaces them, so they stay out of structured data. */}
      <JsonLd
        data={graph(organization(site), breadcrumbs([["Discover", "/discover"]], site), {
          "@type": "CollectionPage",
          url: absoluteUrl("/discover", site.domain),
          name: "Discover",
        })}
      />
      <DiscoverBrowser>
        <section aria-labelledby="how-h">
          <div className="wrap">
            <h2 id="how-h" data-in>
              One listing, found twice
            </h2>
            <div className="features">
              <div className="feature agent" data-in>
                <p className="tag">People</p>
                <h3>Browse it here</h3>
                <p>Search, filter and open a seller's page.</p>
              </div>
              <div className="feature agent" data-in>
                <p className="tag">AI</p>
                <h3>Ask for it in a chat</h3>
                <p>Clients who add {site.name} Network search the same catalog.</p>
              </div>
              <div className="feature" data-in>
                <p className="tag">Sellers</p>
                <h3>{PRICE_FACTS.network} once, then they are yours</h3>
                <p>
                  A new client from the network costs {PRICE_FACTS.network} of the first project. Discover sales join
                  with run V.
                </p>
              </div>
            </div>
            <Link className="more" href="/network">
              How {site.name} Network works
            </Link>
          </div>
        </section>
        <CloseCta />
      </DiscoverBrowser>
    </>
  );
}
