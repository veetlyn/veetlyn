"use client";

import { usePlatformName } from "./platform-name";

// Two strokes meet in a rounded fold around the central dot.
function LogoPaths() {
  return (
    <>
      <path d="M4 6L22.78 50.86L23.88 50.4A8.8 8.8 0 0 1 31.94 38.2L31.93 37L18.96 6Z" fill="currentColor" />
      <circle cx="32" cy="47" r="10" fill="currentColor" />
      <path d="M60 6L41.22 50.86L40.12 50.4A8.8 8.8 0 0 0 32.06 38.2L32.07 37L45.04 6Z" fill="var(--brand)" />
      <path
        d="M41.22 50.86A10 10 0 0 1 22.78 50.86L15.27 32.92A10 10 0 0 1 26 43A6 6 0 1 0 32 37A10 10 0 0 1 41.22 50.86Z"
        fill="var(--brand)"
      />
      <circle cx="32" cy="43" r="6" fill="currentColor" />
    </>
  );
}

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
