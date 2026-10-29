// One agent connected to business records; the leaves are contexts, not separate agents.
export default function ContextualAgentArt() {
  return (
    <svg viewBox="0 0 560 360" className="contextual-agent-art" aria-hidden="true" focusable="false">
      <ellipse cx="282" cy="184" rx="144" ry="124" fill="none" stroke="var(--border)" strokeDasharray="3 8" />
      <path d="M177 90C237 90 205 178 264 178M304 178C364 178 324 78 390 78M287 203C287 246 262 259 218 259" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" opacity="0.55" />
      <circle cx="224" cy="122" r="4" fill="var(--brand)" />
      <circle cx="351" cy="122" r="4" fill="var(--brand)" />
      <circle cx="270" cy="241" r="4" fill="var(--brand)" />
      <g transform="rotate(-5 100 85)">
        <rect x="23" y="30" width="158" height="115" rx="8" fill="var(--tray)" stroke="var(--border)" />
        <rect x="32" y="24" width="158" height="115" rx="8" fill="var(--card)" stroke="var(--border)" />
        <path d="M48 43h15v18H48zM52 48h7m-7 5h7" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" />
        <text x="74" y="56" fill="var(--foreground)" fontSize="17" fontWeight="600">Requests</text>
        <path d="M48 77h120M48 89h96M48 101h66" stroke="var(--muted-foreground)" strokeWidth="4" strokeLinecap="round" opacity="0.25" />
        <circle cx="162" cy="116" r="5" fill="var(--brand)" />
      </g>
      <g transform="rotate(4 452 84)">
        <path d="M376 35h56l10 11h91v93H376z" fill="var(--tray)" stroke="var(--border)" />
        <rect x="368" y="49" width="166" height="100" rx="8" fill="var(--card)" stroke="var(--border)" />
        <text x="385" y="78" fill="var(--foreground)" fontSize="17" fontWeight="600">Projects</text>
        <path d="M385 96h128" stroke="var(--border)" strokeWidth="2" />
        <path d="M385 96h78" stroke="var(--brand)" strokeWidth="3" />
        <circle cx="385" cy="96" r="4" fill="var(--brand)" />
        <circle cx="424" cy="96" r="4" fill="var(--brand)" />
        <circle cx="463" cy="96" r="5" fill="var(--card)" stroke="var(--brand)" strokeWidth="2" />
        <path d="M385 119h74m13 0h38" stroke="var(--muted-foreground)" strokeWidth="4" strokeLinecap="round" opacity="0.25" />
      </g>
      <g transform="rotate(-3 155 275)">
        <rect x="64" y="231" width="170" height="100" rx="8" fill="var(--card)" stroke="var(--border)" />
        <text x="82" y="259" fill="var(--foreground)" fontSize="17" fontWeight="600">Payouts</text>
        <path d="M81 274h135" stroke="var(--border)" />
        <circle cx="87" cy="292" r="5" fill="var(--brand)" />
        <path d="M101 292h42m39 0h33" stroke="var(--muted-foreground)" strokeWidth="4" strokeLinecap="round" opacity="0.4" />
        <circle cx="87" cy="312" r="5" fill="var(--tray)" stroke="var(--muted-foreground)" />
        <path d="M101 312h61m20 0h33" stroke="var(--muted-foreground)" strokeWidth="4" strokeLinecap="round" opacity="0.25" />
      </g>
      <rect x="252" y="147" width="64" height="64" rx="18" fill="var(--tray)" stroke="var(--border)" />
      <rect x="257" y="142" width="54" height="62" rx="16" fill="var(--brand)" />
      <path d="m284 156 4 11 11 4-11 4-4 11-4-11-11-4 11-4z" fill="var(--brand-foreground)" />
      <circle cx="298" cy="187" r="3" fill="var(--brand-foreground)" />
      <text x="338" y="217" fill="var(--foreground)" fontSize="17" fontWeight="600">One agent.</text>
      <text x="338" y="240" fill="var(--muted-foreground)" fontSize="15">Your business context.</text>
      <path d="m326 203-12-8" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" />
    </svg>
  );
}
