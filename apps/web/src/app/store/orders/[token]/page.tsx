import OrderPage from "./order-page";

// No server fetch: the token in the link is the buyer's only credential, checked by order.get.
export default async function StoreOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OrderPage token={token} />;
}
