import PayPage from "./pay-page";

export default async function PayRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PayPage token={token} />;
}
