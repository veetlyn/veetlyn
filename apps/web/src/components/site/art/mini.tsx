import type { ReactElement } from "react";

import type { MiniArtName } from "@/content/site/nav";

// Menu tile pictures: one idea each, drawn from the brand's shapes (the bowl, mint as the signal) in theme tokens.
const MINI = {
  network: (
    <svg viewBox="0 0 72 52" aria-hidden="true" focusable="false">
      <rect width="72" height="52" fill="var(--band)" />
      <rect x="8" y="12" width="28" height="20" rx="5" fill="var(--band-raise)" />
      <path d="M14 32 L12 40 L20 32Z" fill="var(--band-raise)" />
      <rect x="13" y="18" width="16" height="3" rx="1.5" fill="var(--brand)" />
      <rect x="13" y="24" width="11" height="3" rx="1.5" fill="var(--tray)" />
      <path d="M38 22h6" stroke="var(--brand)" strokeWidth="2" strokeDasharray="1 3" strokeLinecap="round" />
      <path d="M52 12H56.0A10 10 0 0 1 56 32H52A6 6 0 0 1 46 26V18A6 6 0 0 1 52 12Z" fill="var(--brand)" />
      <path d="M52 28v-11h5a3 3 0 0 1 0 6h-5" fill="none" stroke="var(--brand-foreground)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  discover: (
    <svg viewBox="0 0 72 52" aria-hidden="true" focusable="false">
      <rect width="72" height="52" fill="var(--band)" />
      <rect x="10" y="9" width="14" height="14" rx="3" fill="var(--band-raise)" />
      <rect x="28" y="9" width="14" height="14" rx="3" fill="var(--band-raise)" />
      <rect x="46" y="9" width="14" height="14" rx="3" fill="var(--band-raise)" />
      <rect x="10" y="27" width="14" height="14" rx="3" fill="var(--band-raise)" />
      <rect x="28" y="27" width="14" height="14" rx="3" fill="var(--brand)" />
      <rect x="46" y="27" width="14" height="14" rx="3" fill="var(--band-raise)" />
    </svg>
  ),
  visibility: (
    <svg viewBox="0 0 72 52" aria-hidden="true" focusable="false">
      <rect width="72" height="52" fill="var(--band)" />
      <rect x="8" y="9" width="42" height="9" rx="4.5" fill="var(--band-raise)" />
      <circle cx="14" cy="13.5" r="2.4" fill="none" stroke="var(--tray)" strokeWidth="1.4" />
      <rect x="12" y="36" width="7" height="8" rx="2" fill="var(--band-raise)" />
      <rect x="23" y="31" width="7" height="13" rx="2" fill="var(--band-raise)" />
      <rect x="34" y="33" width="7" height="11" rx="2" fill="var(--band-raise)" />
      <rect x="45" y="24" width="7" height="20" rx="2" fill="var(--brand)" />
      <path d="M54 30l6-6 4 4" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  membership: (
    <svg viewBox="0 0 72 52" aria-hidden="true" focusable="false">
      <rect width="72" height="52" fill="var(--band)" />
      <path d="M24 10H38.0A16 16 0 0 1 38 42H24A6 6 0 0 1 18 36V16A6 6 0 0 1 24 10Z" fill="var(--brand)" />
      <path d="M27 26l6 6 10-11" fill="none" stroke="var(--brand-foreground)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  freelancers: (
    <svg viewBox="0 0 72 52" aria-hidden="true" focusable="false">
      <rect width="72" height="52" fill="var(--band)" />
      <rect x="12" y="8" width="34" height="36" rx="5" fill="var(--card)" />
      <rect x="17" y="14" width="18" height="3" rx="1.5" fill="var(--foreground)" />
      <rect x="17" y="21" width="22" height="2.5" rx="1.25" fill="var(--tray)" />
      <rect x="17" y="26" width="16" height="2.5" rx="1.25" fill="var(--tray)" />
      <path d="M23 33H30.0A3 3 0 0 1 30 39H23A6 6 0 0 1 17 33V39A6 6 0 0 1 23 33Z" fill="var(--brand)" />
      <circle cx="56" cy="30" r="8" fill="none" stroke="var(--brand)" strokeWidth="2.2" />
    </svg>
  ),
  agencies: (
    <svg viewBox="0 0 72 52" aria-hidden="true" focusable="false">
      <rect width="72" height="52" fill="var(--band)" />
      <path d="M12 18H16.0A8 8 0 0 1 16 34H12A6 6 0 0 1 6 28V24A6 6 0 0 1 12 18Z" fill="var(--card)" />
      <path d="M24 26 C 34 26, 34 12, 44 12" fill="none" stroke="var(--brand)" strokeWidth="2" />
      <circle cx="49" cy="12" r="5" fill="var(--brand)" />
      <rect x="57" y="10" width="10" height="4" rx="2" fill="var(--band-raise)" />
      <path d="M24 26 C 34 26, 34 26, 44 26" fill="none" stroke="var(--tray)" strokeWidth="1.4" />
      <circle cx="49" cy="26" r="5" fill="var(--band-raise)" />
      <rect x="57" y="24" width="10" height="4" rx="2" fill="var(--band-raise)" />
      <path d="M24 26 C 34 26, 34 40, 44 40" fill="none" stroke="var(--tray)" strokeWidth="1.4" />
      <circle cx="49" cy="40" r="5" fill="var(--band-raise)" />
      <rect x="57" y="38" width="10" height="4" rx="2" fill="var(--band-raise)" />
    </svg>
  ),
  stores: (
    <svg viewBox="0 0 72 52" aria-hidden="true" focusable="false">
      <rect width="72" height="52" fill="var(--band)" />
      <path d="M12 12h6l5 20h26l5-14H21" fill="none" stroke="var(--card)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="26" cy="38" r="3" fill="var(--card)" />
      <circle cx="46" cy="38" r="3" fill="var(--card)" />
      <path d="M34 20H40.0A4 4 0 0 1 40 28H34A6 6 0 0 1 28 22V26A6 6 0 0 1 34 20Z" fill="var(--brand)" />
    </svg>
  ),
  studios: (
    <svg viewBox="0 0 72 52" aria-hidden="true" focusable="false">
      <rect width="72" height="52" fill="var(--band)" />
      <rect x="14" y="10" width="22" height="32" rx="4" fill="var(--band-raise)" />
      <path d="M36 10h6a16 16 0 0 1 0 32h-6Z" fill="var(--brand)" />
      <circle cx="22" cy="20" r="3.4" fill="none" stroke="var(--card)" strokeWidth="1.6" />
      <circle cx="28" cy="20" r="3.4" fill="none" stroke="var(--card)" strokeWidth="1.6" />
      <path d="M22 23.5L29 33M28 23.5L21 33" stroke="var(--card)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  plans: (
    <svg viewBox="0 0 72 52" aria-hidden="true" focusable="false">
      <rect width="72" height="52" fill="var(--band)" />
      <rect x="9" y="16" width="15" height="26" rx="4" fill="var(--band-raise)" />
      <rect x="28" y="10" width="15" height="32" rx="4" fill="var(--brand)" />
      <rect x="47" y="16" width="15" height="26" rx="4" fill="var(--band-raise)" />
    </svg>
  ),
} satisfies Record<MiniArtName, ReactElement>;

export default function MiniArt({ name }: { name: MiniArtName }) {
  return MINI[name];
}
