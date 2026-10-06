// Fact 7: PayPal recommends the unsigned JWT — alg "none", iss = partner client ID,
// payer_id = seller merchant ID, empty signature; standard base64 with padding, joined with dots.
export function buildAuthAssertion(input: { clientId: string; payerId: string }): string {
  const header = btoa(JSON.stringify({ alg: "none" }));
  const payload = btoa(JSON.stringify({ iss: input.clientId, payer_id: input.payerId }));
  return `${header}.${payload}.`;
}
