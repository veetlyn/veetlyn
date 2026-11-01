import SettingsTabs from "./settings-tabs";

export default async function SettingsLayout({
  params,
  children,
}: {
  params: Promise<{ storeSlug: string }>;
  children: React.ReactNode;
}) {
  const { storeSlug } = await params;
  return (
    <>
      <SettingsTabs teamSlug={storeSlug} />
      {children}
    </>
  );
}
