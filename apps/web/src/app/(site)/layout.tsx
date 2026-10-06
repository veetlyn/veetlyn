import SiteFooter from "@/components/site/site-footer";
import SiteHeader from "@/components/site/site-header";
import { getPlatformOrigins } from "@/lib/server-api";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { admin } = await getPlatformOrigins();
  return (
    <>
      <SiteHeader adminOrigin={admin} />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </>
  );
}
