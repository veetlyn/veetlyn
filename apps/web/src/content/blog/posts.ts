export const BLOG_CATEGORIES = ["network", "freelancers", "agencies", "stores", "studios", "visibility"] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];
export const categoryLabel = (name: string) =>
  ({
    network: `${name} Network`,
    freelancers: "For freelancers",
    agencies: "For agencies",
    stores: "For stores",
    studios: "For studios",
    visibility: "Getting found",
  }) satisfies Record<BlogCategory, string>;
export type ArticleArtName = "gap" | "freelancer" | "agency" | "store" | "studio" | "visibility";

// The articles' metadata. Bodies are MDX in this folder, joined to these entries by slug in bodies.ts, so this file
// stays importable from plain modules (llms.txt, the sitemap) and their tests.
export type Post = {
  slug: string;
  category: BlogCategory;
  art: ArticleArtName;
  title: string;
  description: string;
  lead: string;
  date: string;
  // Lead, "In short" and body, for BlogPosting's wordCount and the reading time.
  words: number;
  short: readonly string[];
  faq: ReadonlyArray<{ q: string; a: string }>;
  cta: { label: string; href: string };
};

export function posts(site: { name: string; domain: string }): readonly Post[] {
  const { name, domain } = site;
  return [
    {
      slug: "ai-shopping-left-services-out",
      category: "network",
      art: "gap",
      title: `AI shopping left services out. Here is how ${name} Network lets them in`,
      description: `AI assistants sell physical goods. Services, courses and downloads had no way in. ${name} Network is one connector that lets clients' AI find, ask and request, while the client pays on ${name} with PayPal.`,
      lead: "AI assistants now help people shop. Their own checkouts sell physical goods. Freelancers, agencies and everyone who sells their work had no way in.",
      date: "2026-10-19",
      words: 442,
      short: [
        "Assistant checkouts sell physical goods. Services and downloads fall outside their rules.",
        `${name} Network is one connector that clients add to Claude or ChatGPT.`,
        `The AI finds, asks and requests. The client accepts and pays on ${name}, with PayPal.`,
      ],
      faq: [
        { q: `Is ${name} Network in the ChatGPT or Claude directory?`, a: `Not yet. Clients add it by its address, api.${domain}/mcp. Directory listings come after the platforms' review.` },
        { q: "Can the AI spend the client's money?", a: `No. Every payment needs the client's approval in PayPal, on ${name}'s page.` },
        { q: "Who can be found on the network?", a: `Freelancers, agencies, stores and studios on ${name}. Every offering is listed by default, and sellers can take any of them off.` },
      ],
      cta: { label: `How ${name} Network works`, href: "/network" },
    },
    {
      slug: "freelancers-get-hired-from-ai",
      category: "freelancers",
      art: "freelancer",
      title: "Freelancers: get hired from your clients' AI, and paid before you start",
      description: `How a freelancer on ${name} gets briefs from clients' AI, sends a quote drafted by an agent, and collects a deposit through PayPal, with every fee shown to the cent.`,
      lead: `Clients now ask AI who to hire. Here is how a freelancer on ${name} gets the brief, sends the quote and collects a deposit through PayPal.`,
      date: "2026-10-19",
      words: 286,
      short: [
        `Your services are on ${name} Network, so your clients' AI can find you.`,
        "Your intake agent drafts each quote from your prices. You send it.",
        "The client pays half up front with PayPal, as a guest if they like.",
      ],
      faq: [
        { q: "Do my clients need an account?", a: "No. They get a private link and can pay as a PayPal guest." },
        { q: "When do I pay the 5% network fee?", a: `Only on the first project with a client who found you through ${name} Network. The project shows it before you quote.` },
        { q: "Can I bring my own clients?", a: "Yes. Your own clients only pay your plan's 1% fee." },
      ],
      cta: { label: `${name} for freelancers`, href: "/freelancers" },
    },
    {
      slug: "agencies-split-client-payments",
      category: "agencies",
      art: "agency",
      title: "Agencies: one client payment, every member paid by your rules",
      description: `How agencies on ${name} take requests from AI, Discord and their page, let an agent draft quotes, and pay every freelancer their share by approval, by rule or by the payout agent.`,
      lead: `Agencies spend hours paying freelancers by hand. On ${name}, each share is worked out per project and sent by rules you set.`,
      date: "2026-10-19",
      words: 301,
      short: [
        "Requests come from AI, Discord or your page. The intake agent drafts the quote.",
        `The client pays the agency's PayPal. ${name} works out each member's share.`,
        "Payouts go out by approval, by rule, or by the payout agent on the Agency plan.",
      ],
      faq: [
        { q: "Do our members need a PayPal account?", a: "Yes. Each member connects their own PayPal, and their share goes straight to it." },
        { q: "We work in Slack or Microsoft Teams. Can we use them?", a: "Not yet. Slack comes after launch. Today, requests come from AI, Discord and your page, and notices go by email." },
        { q: "We are more than 50 people.", a: "Enterprise covers larger teams, several agencies and custom fees. Talk to sales." },
      ],
      cta: { label: `${name} for agencies`, href: "/agencies" },
    },
    {
      slug: "stores-sell-in-ai-carts",
      category: "stores",
      art: "store",
      title: "Stores: sell in AI carts without building your own ChatGPT app",
      description: `AI assistants can fill a cart, but most stores cannot plug into it. ${name} Network lets clients' AI fill one cart across ${name} stores, with one PayPal payment and an order for each store.`,
      lead: `AI assistants can now fill a shopping cart. Most stores cannot plug into it. ${name} Network gives every store on ${name} a place in it.`,
      date: "2026-10-19",
      words: 238,
      short: [
        `Clients' AI searches products across ${name} stores and fills one cart.`,
        `Checkout happens on ${name}: one PayPal payment, one order for each store.`,
        "Downloads arrive at once. PayPal collects the shipping address for goods.",
      ],
      faq: [
        { q: "Can I import my products from Shopify?", a: `Not yet. Add them to your ${name} store by hand for now.` },
        { q: "Who collects the shipping address?", a: "PayPal, at checkout. You see it on the order." },
        { q: "Do I need a PayPal business account?", a: "Yes. Payments go straight into it." },
      ],
      cta: { label: `${name} for stores`, href: "/stores" },
    },
    {
      slug: "studios-sell-services-and-products",
      category: "studios",
      art: "studio",
      title: "Studios: sell the session and the product from one shop",
      description: `Salons, spas and studios sell time and things. ${name} runs services and products from one workspace and one link, pays staff their share, and halves the cheaper plan when you run both.`,
      lead: `Salons, spas and studios sell time and things. Most tools make you pick one. ${name} runs both from one workspace and one link.`,
      date: "2026-10-19",
      words: 242,
      short: [
        "Services and products share one page, one link and one card in the chat.",
        "Staff get their share of each service through PayPal, by your rules.",
        "Run both and the cheaper plan is half price, with the lower fee on everything.",
      ],
      faq: [
        { q: "Can a client pay for a service and a product at once?", a: "Not yet. A service is paid on its pay page, products at the cart checkout." },
        { q: "Is there a booking calendar?", a: "Not yet. Clients request a time, and you confirm it in the quote." },
      ],
      cta: { label: `${name} for studios`, href: "/studios" },
    },
    {
      slug: "get-found-on-google-and-in-ai-answers",
      category: "visibility",
      art: "visibility",
      title: "How to get found on Google and in AI answers, without ads",
      description: `Search engines and AI assistants read the web the same way: clear pages, plain facts and structured data. What helps a seller get found, and what ${name} does for you.`,
      lead: `Search engines and AI assistants read the web the same way: clear pages, plain facts and structured data. Here is what helps, and what ${name} does for you.`,
      date: "2026-10-19",
      words: 384,
      short: [
        "Give each offer its own page that says what, for whom, where and at what price.",
        "Add structured data so machines read your prices and reviews correctly.",
        "Keep one link for everything, and be listed where AI looks for sellers.",
      ],
      faq: [
        { q: "What is llms.txt?", a: "A plain text file at the root of a site that summarises it for AI tools, with links to the important pages." },
        { q: "Does structured data guarantee a rich result?", a: "No. It helps search engines and AI tools read your page correctly. They decide what to show." },
        { q: `Will ${name} rank me first?`, a: "No one can promise that. We report what happened, honestly." },
      ],
      cta: { label: `Get listed on ${name} Network`, href: "/network" },
    },
  ];
}

export const readingMinutes = (post: Pick<Post, "words">) => Math.max(2, Math.round(post.words / 220));
