import TeamShell from "@/components/team-shell";
import { isServicesTeamSlug } from "@/lib/server-api";

export default async function TeamLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ storeSlug: string }>;
}) {
  const { storeSlug } = await params;
  const kind = (await isServicesTeamSlug(storeSlug)) ? "services" : "store";
  return (
    <TeamShell slug={storeSlug} kind={kind}>
      {children}
    </TeamShell>
  );
}
