import { PRICE_FACTS } from "../../lib/site/fees";
import { AUDIENCES } from "./audiences";

export type MiniArtName =
  | "network"
  | "discover"
  | "visibility"
  | "membership"
  | "freelancers"
  | "agencies"
  | "stores"
  | "studios"
  | "plans";

export type MenuEntry = { path: string; label: string; tagline: string; art: MiniArtName };
export type MenuFeature = { path: string; title: string; text: string; go: string; art: MiniArtName | "gap" };

export const networkMenu = (name: string): readonly MenuEntry[] => [
  { path: "/network", label: `${name} Network`, tagline: "The connector clients add to Claude and ChatGPT", art: "network" },
  { path: "/discover", label: "Discover", tagline: "Browse everything sellers offer on the network", art: "discover" },
  { path: "/visibility", label: "Get found", tagline: "Web SEO for all, AI visibility for members", art: "visibility" },
  { path: "/network#membership", label: "Membership", tagline: "The member check, by waitlist", art: "membership" },
];

export const networkFeature = (name: string): MenuFeature => ({
  path: "/blog/ai-shopping-left-services-out",
  title: `Why ${name} Network exists`,
  text: "AI shopping left services out. Here is the gap it fills.",
  go: "Read the guide",
  art: "gap",
});

export const AUDIENCE_MENU: readonly MenuEntry[] = AUDIENCES;

export const AUDIENCE_FEATURE: MenuFeature = {
  path: "/pricing",
  title: `Plans from ${PRICE_FACTS.from} a month`,
  text: "Services, stores, or both at a lower price. Enterprise on request.",
  go: "Compare plans",
  art: "plans",
};

export const TOP_LINKS = [
  { path: "/pricing", label: "Pricing" },
  { path: "/blog", label: "Blog" },
  { path: "/contact", label: "Contact" },
] as const;
