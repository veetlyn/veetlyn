// The host an OAuth client sends the person back to: the part of the client's identity it cannot choose freely,
// since tokens are only ever delivered there.
export function consentHost(redirectUri: string): string | null {
  try {
    const url = new URL(redirectUri);
    return url.protocol === "https:" || url.hostname === "localhost" ? url.host : null;
  } catch {
    return null;
  }
}

const SEE_LABELS = new Map([
  ["openid", "Which Payleor account is yours"],
  ["profile", "Your name"],
  ["email", "Your email address"],
]);

// What the person grants, in the three groups the consent page shows. Scopes Payleor does not describe are named
// as they are, so nothing is granted silently.
export function consentGroups(scopes: readonly string[]) {
  const unique = [...new Set(scopes)];
  return {
    see: unique.flatMap((scope) => SEE_LABELS.get(scope) ?? []),
    act: [
      "Search offerings and request quotes for you",
      "Reply to a team's questions, once you approve the wording",
      ...(unique.includes("offline_access") ? ["Stay connected until you disconnect it"] : []),
      ...unique.filter((scope) => !SEE_LABELS.has(scope) && scope !== "offline_access").map((scope) => `Use “${scope}”`),
    ],
    never: ["Pay for you", "Accept a quote or a delivery for you"],
  };
}
