"use client";

import { useEffect, useRef } from "react";

const TARGETS = "[data-reveal], [data-draw]";

// Marks the page for motion once it runs, then shows each [data-reveal] part as its section scrolls into view.
// Parts React adds or replaces after the first run are watched too, so none can stay hidden. Without script
// nothing is hidden.
export default function RevealRoot({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.setAttribute("data-motion", "");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-shown", "");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    const watch = (scope: Element) => {
      if (scope.matches(TARGETS) && !scope.hasAttribute("data-shown")) observer.observe(scope);
      for (const el of scope.querySelectorAll(TARGETS)) {
        if (!el.hasAttribute("data-shown")) observer.observe(el);
      }
    };
    watch(root);
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) watch(node);
        }
      }
    });
    mutations.observe(root, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}
