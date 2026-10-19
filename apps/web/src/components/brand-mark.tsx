// Payleor's mark: the P's bowl and a square, the square in the brand colour.
export function BrandMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path
        d="M10.5 25.5V7.5h7a5.75 5.75 0 0 1 0 11.5h-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="19" y="21.5" width="5" height="5" rx="1.25" className="fill-brand" />
    </svg>
  );
}

export function BrandLockup() {
  return (
    <span className="inline-flex items-center gap-2 font-heading text-lg">
      <BrandMark />
      Payleor
    </span>
  );
}
