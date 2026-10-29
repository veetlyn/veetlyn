import { formatOrderFee, getSellerPlan, NETWORK_FEE_BPS, TRIAL_DAYS } from "@jendal-workspace/core";

// An answer may end with a link; structured data reads the link's words as part of the answer.
export type Faq = { q: string; a: string; link?: { label: string; href: string } };

const network = formatOrderFee(NETWORK_FEE_BPS);
const soloFee = formatOrderFee(getSellerPlan("solo").feeBps);

export const faqAnswerText = (f: Faq) => (f.link ? `${f.a} ${f.link.label}.` : f.a);

export const indexFaq = (name: string): readonly Faq[] => [
  {
    q: `Does ${name} hold my money?`,
    a: "No. Clients pay into your PayPal business account. Our fee comes out of the same payment.",
  },
  {
    q: "Can an AI agent spend my money?",
    a: "You control what you delegate. In the alpha, buyer checkout needs your approval in PayPal. Team payouts can follow approvals or the automatic payout rules you set. Connecting an agent does not grant it additional permissions.",
  },
  {
    q: "Can I sell products and services together?",
    a: "Yes. One workspace, one link. Run both and the cheaper plan is half price.",
  },
  { q: `Can an AI sell on ${name}?`, a: "Yes. Connect it through our API. Buyers see that the work is automated." },
  { q: "Can I leave with my data?", a: "Yes. A full export is coming soon. The code is open source under AGPL-3.0." },
];

export const networkFaq = (name: string): readonly Faq[] => [
  {
    q: `Is ${name} Network in the Claude or ChatGPT directory?`,
    a: "Not yet. Clients add it by its address. Directory listings come after the platforms' review.",
  },
  { q: "Can the AI pay for my client?", a: `No. The client pays on ${name} and approves the payment in PayPal.` },
  {
    q: "Do I have to be listed?",
    a: "No. Every offering is listed by default, and you can take any of them off the network.",
  },
  {
    q: "What does it cost me?",
    a: `${network} once, on the first project with a client the network brings you. Nothing after that.`,
  },
];

export const FREELANCER_FAQ: readonly Faq[] = [
  { q: "Do my clients need an account?", a: "No. They get a private link and can pay as a PayPal guest." },
  {
    q: `When do I pay the ${network} network fee?`,
    a: "Only on the first project with a client who found you through an AI agent. You see it before you quote.",
  },
  { q: "Can an AI agent send a quote for me?", a: "No. The intake agent drafts it. You send it." },
  { q: "Can I bring my own clients?", a: `Yes. Your own clients only pay your plan's ${soloFee} fee.` },
];

export const agencyFaq = (name: string): readonly Faq[] => [
  {
    q: "How do members get paid?",
    a: "Each member connects their own PayPal. Their share goes out after your approval, by your rules, or on payday.",
  },
  {
    q: "We work in Slack or Microsoft Teams. Can we use them?",
    a: "Not yet. Slack, Discord and Google Chat are coming. Today, requests come from AI and your page, and notices go by email.",
  },
  {
    q: `Can our own agent work with ${name}?`,
    a: "Yes, through the public API and webhooks on Team and Agency. The payer still approves every payment in PayPal.",
  },
  {
    q: `We are more than ${getSellerPlan("agency").members} people.`,
    a: "Enterprise covers larger teams, several agencies and custom fees.",
    link: { label: "Talk to sales", href: "/contact#sales" },
  },
];

export const storeFaq = (name: string): readonly Faq[] => [
  {
    q: "Can I bring my products from Shopify, WooCommerce or Gumroad?",
    a: `Add them to your ${name} store. There is no import tool yet.`,
  },
  { q: "Can I sell shipped goods?", a: "Not yet. Courses and downloads work today; shipping is coming." },
  { q: "Do I need a PayPal business account?", a: "Yes. Payments go straight into it." },
  {
    q: "Can I sell services too?",
    a: "Yes. Run both and the cheaper plan is half price.",
    link: { label: "See how", href: "/studios" },
  },
];

export const STUDIO_FAQ: readonly Faq[] = [
  { q: "Do clients see services and products together?", a: "Yes, on your page. In the chat, services today and products soon." },
  {
    q: "Can a client pay for a service and a product at once?",
    a: "Not yet. A service is paid on its pay page, products at checkout on your page.",
  },
  {
    q: "Can my staff get a share of each service?",
    a: "Yes. Your payout rules send each person their share through PayPal.",
  },
  { q: "Which fee applies when I run both?", a: "The lower of your two plans, on every payment and order." },
];

export const pricingFaq = (name: string): readonly Faq[] => [
  {
    q: `Do my clients pay anything to ${name}?`,
    a: "No. Clients pay the price you set, through PayPal, without an account. Your fees come out of what you receive.",
  },
  {
    q: "Is there a fee on payouts to my team?",
    a: `${name} adds nothing. PayPal charges its own payout fee, shown before you send.`,
  },
  {
    q: "How do you know a client came from the network?",
    a: `Their first request starts inside an AI agent through ${name}. The project shows it before you quote.`,
  },
  {
    q: "Can I leave and take my data?",
    a: "Yes, on every plan. Export your projects, clients, payments and files at any time.",
  },
  {
    q: "Is SEO included?",
    a: "Web SEO on seller pages is coming soon to every plan. AI visibility comes with Network membership, which opens by waitlist with manual approval.",
  },
  {
    q: "Is there a free trial?",
    a: `${TRIAL_DAYS} days on any plan, with no setup fee. You choose a plan before your first client payment.`,
  },
];

export const visibilityFaq = (name: string): readonly Faq[] => [
  {
    q: "What does every plan get?",
    a: `Web SEO on every seller page, coming soon: structured data, a sitemap, an llms.txt, fast pages, and a listing on Discover and ${name} Network.`,
  },
  {
    q: "How do I get AI visibility?",
    a: "Join the Network membership waitlist. We approve members by hand, starting with sellers who can show their reputation.",
  },
  {
    q: "Will an agent change my pages on its own?",
    a: "No. It drafts every change, and nothing ships until you approve it.",
  },
  { q: "Will you rank me first?", a: "No one can promise that. We report what happened, honestly." },
];
