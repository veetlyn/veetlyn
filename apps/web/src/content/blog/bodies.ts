import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";

import Agencies from "./agencies-split-client-payments.mdx";
import Gap from "./ai-shopping-left-services-out.mdx";
import Freelancers from "./freelancers-get-hired-from-ai.mdx";
import Visibility from "./get-found-on-google-and-in-ai-answers.mdx";
import Stores from "./stores-sell-in-ai-carts.mdx";
import Studios from "./studios-sell-services-and-products.mdx";

export const POST_BODIES = {
  "ai-shopping-left-services-out": Gap,
  "freelancers-get-hired-from-ai": Freelancers,
  "agencies-split-client-payments": Agencies,
  "stores-sell-in-ai-carts": Stores,
  "studios-sell-services-and-products": Studios,
  "get-found-on-google-and-in-ai-answers": Visibility,
} satisfies Record<string, ComponentType<{ components?: MDXComponents }>>;
