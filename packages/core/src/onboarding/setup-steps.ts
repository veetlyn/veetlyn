import type { StoreRecord } from "../tenancy/store";

// Later plans append steps (W1-B links PayPal onboarding; billing adds a plan).
export type SetupStep = { id: string; label: string; done: boolean; href?: string };

export function setupSteps(
  store: Pick<StoreRecord, "status" | "paypalMerchantId">,
  links: { storefrontUrl: string; productsUrl: string },
  progress: { productCount: number },
): SetupStep[] {
  return [
    { id: "create-store", label: "Create your store", done: true },
    { id: "add-product", label: "Add your first product", done: progress.productCount > 0, href: links.productsUrl },
    { id: "connect-paypal", label: "Connect PayPal", done: store.paypalMerchantId !== null },
    // A visit cannot be detected, so the step counts as done once the storefront is live.
    { id: "visit-storefront", label: "Visit your storefront", done: store.status === "active", href: links.storefrontUrl },
  ];
}

export function countDone(steps: readonly SetupStep[]): number {
  return steps.filter((step) => step.done).length;
}
