"use client";

import { useEffect, useRef } from "react";

// Marks the page for motion once it runs, then shows each [data-reveal] part as its section scrolls into view.
// Without script nothing is hidden.
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
    for (const el of root.querySelectorAll("[data-reveal]")) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return <div ref={ref}>{children}</div>;
}
