import type { StoreRecord } from "../tenancy/store";

// Later plans append steps (W1-B links PayPal onboarding; billing adds a plan).
export type SetupStep = { id: string; label: string; done: boolean; href?: string };

export function setupSteps(
  store: Pick<StoreRecord, "status" | "paypalMerchantId">,
  links: { productsUrl: string; connectPaypal?: string; publish?: string },
  progress: { productCount: number },
): SetupStep[] {
  const paypalDone = store.paypalMerchantId !== null;
  return [
    { id: "create-store", label: "Create your store", done: true },
    { id: "add-product", label: "Add your first product", done: progress.productCount > 0, href: links.productsUrl },
    links.connectPaypal
      ? { id: "connect-paypal", label: "Connect PayPal", done: paypalDone, href: links.connectPaypal }
      : { id: "connect-paypal", label: "Connect PayPal", done: paypalDone },
    { id: "publish", label: "Publish your store", done: store.status === "active", ...(links.publish ? { href: links.publish } : {}) },
  ];
}

export function countDone(steps: readonly SetupStep[]): number {
  return steps.filter((step) => step.done).length;
}
