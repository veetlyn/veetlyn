import "@/components/site/site.css";
import SiteFooter from "@/components/site/site-footer";
import SiteHeader from "@/components/site/site-header";
import { getPlatformOrigins } from "@/lib/server-api";

// Pay pages, client project pages and the legal pages keep their own styles; only the site's header and footer
// take the site's design, each in its own scoped root.
export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const { dash } = await getPlatformOrigins();
  return (
    <>
      <div className="site-root">
        <SiteHeader dashOrigin={dash} />
      </div>
      <div className="flex-1">{children}</div>
      <div className="site-root">
        <SiteFooter />
      </div>
    </>
  );
}
