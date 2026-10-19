export type Listing = {
  title: string;
  seller: string;
  member: boolean;
  kind: "service" | "download" | "course" | "product";
  done: "people" | "both" | "ai";
  category: "design" | "development" | "writing" | "video" | "courses" | "templates" | "beauty" | "goods";
  priceLabel: string;
  priceDollars: number;
  detail: string;
  glyph: string;
  tone: 1 | 2 | 3 | 4;
};

export const KIND_LABEL = { service: "Service", download: "Download", course: "Course", product: "Goods" } as const satisfies Record<
  Listing["kind"],
  string
>;
export const DONE_LABEL = { people: "By people", both: "People with AI", ai: "Automated" } as const satisfies Record<
  Listing["done"],
  string
>;

// Sample listings while the network opens, in the "Featured" order; the network's search replaces them. Never put
// them in structured data.
export const SAMPLE_LISTINGS: readonly Listing[] = [
  { title: "Logo and brand kit", seller: "Walk Crew", member: true, kind: "service", done: "people", category: "design", priceLabel: "From $400", priceDollars: 400, detail: "7 to 14 days", glyph: "WC", tone: 1 },
  { title: "Landing page in Webflow", seller: "Fold Studio", member: true, kind: "service", done: "both", category: "development", priceLabel: "From $1,200", priceDollars: 1200, detail: "10 days", glyph: "FS", tone: 2 },
  { title: "Pedicure", seller: "Maison Lune", member: true, kind: "service", done: "people", category: "beauty", priceLabel: "$45", priceDollars: 45, detail: "45 min", glyph: "ML", tone: 4 },
  { title: "Podcast mix and master", seller: "Northwave Audio", member: true, kind: "service", done: "people", category: "video", priceLabel: "$90 an episode", priceDollars: 90, detail: "48 hours", glyph: "NA", tone: 3 },
  { title: "Logo ideas in a minute", seller: "Logo Bot", member: false, kind: "service", done: "ai", category: "design", priceLabel: "$29", priceDollars: 29, detail: "Ready now", glyph: "LB", tone: 3 },
  { title: "Brand identity", seller: "Amadou", member: true, kind: "service", done: "people", category: "design", priceLabel: "From $600", priceDollars: 600, detail: "2 to 3 weeks", glyph: "AM", tone: 1 },
  { title: "Shopify fixes", seller: "Patchwork Dev", member: false, kind: "service", done: "people", category: "development", priceLabel: "From $90", priceDollars: 90, detail: "1 to 3 days", glyph: "PD", tone: 4 },
  { title: "Website copy", seller: "Quill and Co", member: true, kind: "service", done: "both", category: "writing", priceLabel: "From $300", priceDollars: 300, detail: "5 days", glyph: "QC", tone: 2 },
  { title: "Deck translation", seller: "Lingo Bot", member: false, kind: "service", done: "ai", category: "writing", priceLabel: "$12", priceDollars: 12, detail: "Ready in minutes", glyph: "LG", tone: 3 },
  { title: "YouTube video edit", seller: "Cutroom", member: false, kind: "service", done: "both", category: "video", priceLabel: "From $150", priceDollars: 150, detail: "3 days", glyph: "CR", tone: 1 },
  { title: "Pricing your services", seller: "Amadou", member: true, kind: "course", done: "people", category: "courses", priceLabel: "$49", priceDollars: 49, detail: "6 lessons", glyph: "PS", tone: 2 },
  { title: "Glazing course", seller: "Clay Room", member: true, kind: "course", done: "people", category: "courses", priceLabel: "$29", priceDollars: 29, detail: "6 videos", glyph: "GC", tone: 4 },
  { title: "Freelance OS for Notion", seller: "Desk and Co", member: false, kind: "download", done: "people", category: "templates", priceLabel: "$19", priceDollars: 19, detail: "Notion template", glyph: "OS", tone: 3 },
  { title: "Film preset pack", seller: "Lightfold", member: false, kind: "download", done: "people", category: "templates", priceLabel: "$15", priceDollars: 15, detail: "12 presets", glyph: "LF", tone: 1 },
  { title: "Argan shampoo", seller: "Maison Lune", member: true, kind: "product", done: "people", category: "beauty", priceLabel: "$18", priceDollars: 18, detail: "250 ml, shipped", glyph: "AS", tone: 2 },
  { title: "Yoga class pack", seller: "Studio Ama", member: false, kind: "service", done: "people", category: "beauty", priceLabel: "$60", priceDollars: 60, detail: "5 classes", glyph: "YA", tone: 3 },
  { title: "Blue mug", seller: "Clay Room", member: true, kind: "product", done: "people", category: "goods", priceLabel: "$18", priceDollars: 18, detail: "Shipped", glyph: "BM", tone: 4 },
  { title: "Coffee beans, 1 kg", seller: "Roast House", member: false, kind: "product", done: "people", category: "goods", priceLabel: "$24", priceDollars: 24, detail: "Shipped", glyph: "RH", tone: 1 },
];
