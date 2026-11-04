"use client";

import { LogoPaths } from "./brand-paths";
import { usePlatformName } from "./platform-name";

// The mark alone, in a square box.
export function BrandMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="2 1.5 60 60" className={className} aria-hidden="true">
      <LogoPaths />
    </svg>
  );
}

// The name with the mark as its first letter, sized to the capitals of the surrounding text.
export function BrandWordmark({ className = "" }: { className?: string }) {
  const name = usePlatformName();
  if (!name.startsWith("V")) return <span className={className}>{name}</span>;
  return (
    <span className={`whitespace-nowrap ${className}`}>
      <svg viewBox="4 6 56 51" aria-hidden="true" className="brand-v inline-block h-[0.7em] w-auto align-baseline">
        <LogoPaths />
      </svg>
      <span aria-hidden="true">{name.slice(1)}</span>
      <span className="sr-only">{name}</span>
    </span>
  );
}

export function BrandLockup() {
  return <BrandWordmark className="font-heading text-lg" />;
}
