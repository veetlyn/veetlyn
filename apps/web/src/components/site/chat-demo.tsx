"use client";

import { type ReactNode, useEffect, useRef } from "react";

const TYPE_MS = 28;
const START_MS = 500;
const PRESS_MS = 400;

// A sandbox chat that plays once: the client's message types itself, each `.frame` shows at its `data-at` time and
// each `[data-press]` button is pressed at its time and turns into its `data-done` label. The server renders the
// end of the story's text, so the card reads fully without script; reduced motion shows the end state at once.
export default function ChatDemo({
  label,
  who,
  message,
  children,
}: {
  label: string;
  who: string;
  message: string;
  children: ReactNode;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const typed = useRef<HTMLParagraphElement>(null);
  const replay = useRef<() => void>(() => {});

  useEffect(() => {
    const root = stage.current;
    const bubble = typed.current;
    if (!root || !bubble) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frames = [...root.querySelectorAll<HTMLElement>(".frame")];
    const presses = [...root.querySelectorAll<HTMLElement>("[data-press]")];
    const labels = new Map(presses.map((b) => [b, b.textContent ?? ""]));
    let timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const done = (b: HTMLElement, on: boolean) => {
      b.classList.toggle("done", on);
      b.textContent = on ? (b.dataset.done ?? "") : (labels.get(b) ?? "");
    };
    const caret = () => Object.assign(document.createElement("span"), { className: "caret" });

    const run = () => {
      for (const f of frames) later(Number(f.dataset.at), () => f.classList.remove("wait"));
      for (const b of presses) {
        const at = Number(b.dataset.press);
        later(at, () => b.classList.add("pressed"));
        later(at + PRESS_MS, () => {
          b.classList.remove("pressed");
          done(b, true);
        });
      }
    };
    const play = () => {
      timers.forEach(clearTimeout);
      timers = [];
      for (const b of presses) {
        b.classList.remove("pressed");
        done(b, false);
      }
      if (reduce) {
        for (const f of frames) f.classList.remove("wait");
        bubble.textContent = message;
        for (const b of presses) done(b, true);
        return;
      }
      for (const f of frames) f.classList.add("wait");
      bubble.replaceChildren(caret());
      let i = 0;
      const tick = () => {
        i += 1;
        bubble.replaceChildren(message.slice(0, i), ...(i < message.length ? [caret()] : []));
        if (i < message.length) later(TYPE_MS, tick);
        else run();
      };
      later(START_MS, tick);
    };
    replay.current = play;
    play();
    return () => {
      timers.forEach(clearTimeout);
      for (const f of frames) f.classList.remove("wait");
      for (const b of presses) done(b, false);
      bubble.textContent = message;
    };
  }, [message]);

  return (
    <div className="stage" ref={stage}>
      <div className="stage-art" role="img" aria-label={label}>
        <p className="who">{who}</p>
        <p className="bubble" ref={typed}>
          {message}
        </p>
        {children}
      </div>
      <div className="foot">
        <span>Example</span>
        <button className="replay" type="button" onClick={() => replay.current()}>
          Play again
        </button>
      </div>
    </div>
  );
}
