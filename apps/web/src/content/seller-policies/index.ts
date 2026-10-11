import type { StorePolicy } from "@jendal-workspace/core";

import type { PolicyPage } from "../store-policies/shared";
import SellerPrivacy from "./privacy";
import SellerTerms from "./terms";

// Services sellers publish only some of the store policies.
export const SELLER_POLICY_PAGES = new Map<StorePolicy, PolicyPage>([
  ["terms", { title: "Terms of service", Body: SellerTerms }],
  ["privacy", { title: "Privacy policy", Body: SellerPrivacy }],
]);
