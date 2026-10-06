import type { MDXComponents } from "mdx/types";

import { A, H2, LI, OL, P, Strong, UL } from "./prose";

export const legalMdxComponents: MDXComponents = { h2: H2, p: P, ul: UL, ol: OL, li: LI, a: A, strong: Strong };
