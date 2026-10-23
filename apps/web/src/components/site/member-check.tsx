"use client";

import { usePlatformName } from "@/components/platform-name";

export default function MemberCheck() {
  const name = usePlatformName();
  return (
    <span className="check" title={`${name} Network member`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 3h9.5a8.5 8.5 0 0 1 0 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="var(--brand)" />
        <path
          d="M7.5 11.6l3 3 5.5-6"
          fill="none"
          stroke="var(--brand-foreground)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Member
    </span>
  );
}
