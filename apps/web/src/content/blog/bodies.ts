import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";

import Agencies from "./agencies-split-client-payments.mdx";
import Gap from "./how-clients-hire-through-their-ai.mdx";
import Freelancers from "./freelancers-get-hired-from-ai.mdx";
import Visibility from "./get-found-on-google-and-in-ai-answers.mdx";
import Stores from "./stores-sell-courses-and-downloads.mdx";
import Studios from "./studios-sell-services-and-products.mdx";

export const POST_BODIES = new Map<string, ComponentType<{ components?: MDXComponents }>>([
  ["how-clients-hire-through-their-ai", Gap],
  ["freelancers-get-hired-from-ai", Freelancers],
  ["agencies-split-client-payments", Agencies],
  ["stores-sell-courses-and-downloads", Stores],
  ["studios-sell-services-and-products", Studios],
  ["get-found-on-google-and-in-ai-answers", Visibility],
]);

// Earlier addresses of renamed posts, so old links still land on the post.
export const RENAMED_POSTS = new Map<string, string>([
  ["ai-shopping-left-services-out", "how-clients-hire-through-their-ai"],
  ["stores-sell-in-ai-carts", "stores-sell-courses-and-downloads"],
]);
