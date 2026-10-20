"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Entrances: parts rise in once as they arrive. Without script nothing moves and nothing is hidden; the rise is a
// translate only, and reduced motion removes it (site.css).
export default function Reveal() {
  const pathname = usePathname();
  useEffect(() => {
    document.documentElement.classList.add("js");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    document.querySelectorAll<HTMLElement>(".site-root [data-in]:not(.in)").forEach((el, i) => {
      el.style.transitionDelay = `${(i % 3) * 80}ms`;
      io.observe(el);
    });
    return () => io.disconnect();
  }, [pathname]);
  return null;
}
