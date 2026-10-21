"use client";

import { createContext, useContext } from "react";

const PlatformNameContext = createContext<string | null>(null);

export function PlatformNameProvider({ name, children }: { name: string; children: React.ReactNode }) {
  return <PlatformNameContext.Provider value={name}>{children}</PlatformNameContext.Provider>;
}

export function usePlatformName(): string {
  const name = useContext(PlatformNameContext);
  if (name === null) throw new Error("usePlatformName needs PlatformNameProvider above it.");
  return name;
}

export function PlatformName() {
  return usePlatformName();
}
