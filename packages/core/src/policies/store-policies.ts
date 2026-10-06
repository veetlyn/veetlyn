export const STORE_POLICIES = ["returns", "shipping", "terms", "privacy"] as const;

export type StorePolicy = (typeof STORE_POLICIES)[number];

export function isStorePolicy(value: string): value is StorePolicy {
  return STORE_POLICIES.some((policy) => policy === value);
}

// The ACP and UCP adapters reuse these for their policy links.
export function storePolicyUrls(storeBaseUrl: string): Record<StorePolicy, string> {
  const base = storeBaseUrl.replace(/\/+$/, "");
  return {
    returns: `${base}/policies/returns`,
    shipping: `${base}/policies/shipping`,
    terms: `${base}/policies/terms`,
    privacy: `${base}/policies/privacy`,
  };
}
