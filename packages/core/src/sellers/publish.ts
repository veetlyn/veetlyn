import type { StoreStatus } from "../tenancy/store";
import type { TeamProduct } from "../tenancy/team-product";

export type PublishState = {
  product: TeamProduct;
  status: StoreStatus;
  paypalMerchantId: string | null;
  // Active services for a services team, published products for a store.
  listedCount: number;
};

// Sellers design §3.2: a seller publishes once it can take payments and has something to sell.
export function publishProblem(state: PublishState): string | null {
  if (state.status === "suspended") return "This seller is suspended. Contact support@payleor.com.";
  if (state.paypalMerchantId === null) return "Connect PayPal before you publish.";
  if (state.listedCount === 0) {
    return state.product === "services"
      ? "Add at least one active service before you publish."
      : "Publish at least one product before you publish your store.";
  }
  return null;
}
