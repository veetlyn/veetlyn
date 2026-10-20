import ClientProject from "./client-project";

export default async function ClientProjectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ClientProject token={token} />;
}
