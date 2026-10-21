export const HIDDEN_CONTACT = "[hidden until a quote is accepted]";

// Messaging, social and freelance sites (conversations design §6). File and reference links are not here, so a
// brief can still point at Drive, Dropbox, Figma or a website.
const DENIED_HOSTS = [
  "wa.me",
  "whatsapp.com",
  "t.me",
  "telegram.me",
  "telegram.org",
  "signal.me",
  "signal.group",
  "discord.gg",
  "linkedin.com",
  "instagram.com",
  "facebook.com",
  "fb.me",
  "m.me",
  "messenger.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "snapchat.com",
  "fiverr.com",
  "upwork.com",
  "malt.com",
  "malt.fr",
  "freelancer.com",
  "calendly.com",
  "cal.com",
  "skype.com",
];
// Hosts that also serve harmless pages: only these paths are contact channels.
const DENIED_PATHS: [string, string][] = [
  ["discord.com", "/invite"],
  ["discordapp.com", "/invite"],
];

const EMAIL = String.raw`[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}`;
const URL = String.raw`(?:https?://)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:/[^\s]*[^\s.,;:!?)\]'"])?`;
const PHONE = String.raw`\+?\(?\d[\d\s().-]{5,}\d`;
// Email first: at the start of an address the URL pattern would also match its local part.
const CANDIDATES = new RegExp(`(${EMAIL})|(${URL})|(${PHONE})`, "gi");
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_PHONE_DIGITS = 7;

function deniedUrl(candidate: string): boolean {
  const withoutScheme = candidate.replace(/^https?:\/\//i, "");
  const slash = withoutScheme.indexOf("/");
  const host = (slash === -1 ? withoutScheme : withoutScheme.slice(0, slash))
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
  const path = slash === -1 ? "" : withoutScheme.slice(slash).toLowerCase();
  const under = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  return DENIED_HOSTS.some(under) || DENIED_PATHS.some(([domain, prefix]) => under(domain) && path.startsWith(prefix));
}

function isPhone(candidate: string): boolean {
  if (ISO_DATE.test(candidate)) return false;
  return (candidate.match(/\d/g)?.length ?? 0) >= MIN_PHONE_DIGITS;
}

// Hides what would let the two sides deal off the platform before a quote is accepted. Allowed links are matched
// whole, so the digits inside them are never taken for a phone number. Details written out in words pass.
export type MaskedBody = { shown: string; masked: boolean };

export function maskContactDetails(body: string): MaskedBody {
  let masked = false;
  const shown = body.replace(CANDIDATES, (match: string, email?: string, url?: string) => {
    const hide = email ? true : url ? deniedUrl(url) : isPhone(match);
    if (!hide) return match;
    masked = true;
    return HIDDEN_CONTACT;
  });
  return { shown, masked };
}
