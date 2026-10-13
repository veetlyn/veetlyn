const PAYPAL_HOSTS: ReadonlyMap<string, string> = new Map([
  ["www.paypal.com", "live"],
  ["www.sandbox.paypal.com", "sandbox"],
]);

// The signup URL PayPal returns tells us which host serves the mini-browser's partner.js.
export function payPalOnboardingLinks(actionUrl: string): { miniBrowserHref: string; partnerScriptSrc: string } | null {
  let url: URL;
  try {
    url = new URL(actionUrl);
  } catch {
    return null;
  }
  const environment = PAYPAL_HOSTS.get(url.host);
  if (environment === undefined) return null;
  url.searchParams.set("displayMode", "minibrowser");
  return {
    miniBrowserHref: url.toString(),
    partnerScriptSrc: `https://www.${environment === "sandbox" ? "sandbox." : ""}paypal.com/webapps/merchantboarding/js/lib/lightbox/partner.js`,
  };
}
