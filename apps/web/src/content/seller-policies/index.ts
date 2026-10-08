import type { StorePolicy } from "@jendal-workspace/core";

import type { PolicyStore } from "../store-policies/shared";
import SellerPrivacy from "./privacy";
import SellerTerms from "./terms";

export const SELLER_POLICY_PAGES: Partial<
  Record<StorePolicy, { title: string; Body: (props: { store: PolicyStore }) => React.ReactNode }>
> = {
  terms: { title: "Terms of service", Body: SellerTerms },
  privacy: { title: "Privacy policy", Body: SellerPrivacy },
};
