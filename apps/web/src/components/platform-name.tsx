"use client";

import { createContext, useContext } from "react";

type PlatformInfo = { name: string; domain: string; storeDomain: string };

const PlatformNameContext = createContext<PlatformInfo | null>(null);

export function PlatformNameProvider({
  name,
  domain = "",
  storeDomain = "",
  children,
}: {
  name: string;
  domain?: string;
  storeDomain?: string;
  children: React.ReactNode;
}) {
  return (
    <PlatformNameContext.Provider value={{ name, domain, storeDomain }}>{children}</PlatformNameContext.Provider>
  );
}

export function usePlatformName(): string {
  const info = useContext(PlatformNameContext);
  if (info === null) throw new Error("usePlatformName needs PlatformNameProvider above it.");
  return info.name;
}

export function usePlatformInfo(): PlatformInfo {
  const info = useContext(PlatformNameContext);
  if (info === null) throw new Error("usePlatformInfo needs PlatformNameProvider above it.");
  return info;
}

export function PlatformName() {
  return usePlatformName();
}

export function PlatformDomain() {
  return usePlatformInfo().domain;
}

export function StoreDomain() {
  return usePlatformInfo().storeDomain;
}

export function PlatformEmail({ local }: { local: string }) {
  const { domain } = usePlatformInfo();
  const address = `${local}@${domain}`;
  return <a href={`mailto:${address}`}>{address}</a>;
}
