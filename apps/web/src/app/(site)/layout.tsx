import "./site.css";
import SiteFooter from "@/components/site/site-footer";
import SiteHeader from "@/components/site/site-header";
import { getPlatformOrigins } from "@/lib/server-api";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { dash } = await getPlatformOrigins();
  return (
    <div className="site-root flex-1">
      <SiteHeader dashOrigin={dash} />
      {children}
      <SiteFooter />
    </div>
  );
}
