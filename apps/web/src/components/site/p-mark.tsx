// The P of the logo, inline with text: on chat cards, terms and answer chips.
export default function PMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M10.5 25.5V7.5h7a5.75 5.75 0 0 1 0 11.5h-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="19" y="21.5" width="5" height="5" rx="1.25" fill="var(--brand)" />
    </svg>
  );
}
