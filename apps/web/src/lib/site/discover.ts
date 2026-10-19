import { DONE_LABEL, KIND_LABEL, type Listing } from "../../content/site/listings";

export type Filters = {
  q?: string;
  category?: Listing["category"] | "all";
  type?: Listing["kind"] | "all";
  done?: Listing["done"] | "all";
  sort?: "featured" | "price";
};

const matches = <T extends string>(wanted: T | "all" | undefined, value: T) =>
  !wanted || wanted === "all" || wanted === value;

export function browse(items: readonly Listing[], f: Filters): Listing[] {
  const words = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const found = items.filter((i) => {
    const text =
      `${i.title} ${i.seller} ${KIND_LABEL[i.kind]} ${DONE_LABEL[i.done]} ${i.category} ${i.detail}`.toLowerCase();
    return (
      matches(f.category, i.category) &&
      matches(f.type, i.kind) &&
      matches(f.done, i.done) &&
      words.every((w) => text.includes(w))
    );
  });
  // toSorted is stable, so equal prices keep the featured order.
  return f.sort === "price" ? found.toSorted((a, b) => a.priceDollars - b.priceDollars) : found;
}
