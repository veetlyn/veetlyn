"use client";

import { useEffect, useState } from "react";

// Starts counting down on mount, because the page opens right after an email was sent.
export function useCooldown(seconds: number): { remaining: number; restart: () => void } {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  return { remaining, restart: () => setRemaining(seconds) };
}
