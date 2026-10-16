import SiteFooter from "@/components/site/site-footer";
import SiteHeader from "@/components/site/site-header";
import { getPlatformOrigins } from "@/lib/server-api";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { dash } = await getPlatformOrigins();
  return (
    <>
      <SiteHeader dashOrigin={dash} />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </>
  );
}
