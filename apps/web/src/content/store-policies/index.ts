import type { StorePolicy } from "@jendal-workspace/core";

import PrivacyPolicy from "./privacy";
import ReturnsPolicy from "./returns";
import type { PolicyPage } from "./shared";
import ShippingPolicy from "./shipping";
import StoreTerms from "./terms";

export const STORE_POLICY_PAGES = {
  returns: { title: "Return policy", Body: ReturnsPolicy },
  shipping: { title: "Shipping policy", Body: ShippingPolicy },
  terms: { title: "Terms of service", Body: StoreTerms },
  privacy: { title: "Privacy policy", Body: PrivacyPolicy },
} satisfies Record<StorePolicy, PolicyPage>;
