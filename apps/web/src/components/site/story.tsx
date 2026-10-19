"use client";

import { type ReactNode, useEffect, useRef } from "react";

// A story told in steps beside a pinned stage: on a wide screen the step nearest the middle of the window picks the
// scene and fills the rail; on a phone each step carries a copy of its own scene. Split bars (`[data-grow]`) grow
// when their scene is on.
export default function Story({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const story = root.current;
    if (!story) return;
    const steps = [...story.querySelectorAll<HTMLElement>(".step")];
    const scenes = [...story.querySelectorAll<HTMLElement>(".scene")];
    const copies = scenes.flatMap((scene, i) => {
      const first = scene.firstElementChild;
      const step = steps[i];
      if (!first || !step) return [];
      const copy = first.cloneNode(true);
      if (!(copy instanceof HTMLElement)) return [];
      const box = document.createElement("div");
      box.className = "inline-scene";
      box.setAttribute("aria-hidden", "true");
      copy.querySelectorAll<HTMLElement>("[data-grow]").forEach((g) => {
        g.style.flexGrow = g.dataset.grow ?? "1";
      });
      box.appendChild(copy);
      step.appendChild(box);
      return [box];
    });
    const grow = [...story.querySelectorAll<HTMLElement>(".scene [data-grow]")];
    const split = scenes.findIndex((s) => s.querySelector("[data-grow]"));
    const rail = story.querySelector<HTMLElement>(".rail i");
    const box = story.querySelector<HTMLElement>(".steps");
    let current = -1;
    let raf = 0;

    const onScroll = () => {
      const mid = innerHeight * 0.5;
      let best = 0;
      steps.forEach((step, i) => {
        if (step.getBoundingClientRect().top < mid) best = i;
      });
      if (best !== current) {
        current = best;
        steps.forEach((step, i) => step.classList.toggle("on", i <= best));
        scenes.forEach((scene, i) => scene.classList.toggle("on", i === best));
        for (const g of grow) g.style.flexGrow = best === split ? (g.dataset.grow ?? "1") : "0.0001";
      }
      if (rail && box) {
        const r = box.getBoundingClientRect();
        rail.style.scale = `1 ${Math.min(1, Math.max(0, (mid - r.top) / r.height))}`;
      }
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(onScroll);
    };
    for (const g of grow) g.style.flexGrow = "0.0001";
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    onScroll();
    return () => {
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      cancelAnimationFrame(raf);
      for (const c of copies) c.remove();
    };
  }, []);

  return (
    <div className="story" ref={root}>
      {children}
    </div>
  );
}
