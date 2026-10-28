// Home page pictures in the menu tiles' language (rounded blocks, the bowl, mint as the signal). Each one loops one
// short story once it scrolls into view; reduced motion shows its end state.

const BOWL = "M52 12H56.0A10 10 0 0 1 56 32H52A6 6 0 0 1 46 26V18A6 6 0 0 1 52 12Z";
const BOWL_P = "M52 28v-11h5a3 3 0 0 1 0 6h-5";

function Bowl({ x, y, size }: { x: number; y: number; size: number }) {
  const k = size / 20;
  return (
    <g transform={`translate(${x - 56 * k} ${y - 22 * k}) scale(${k})`}>
      <path d={BOWL} fill="var(--brand)" />
      <path d={BOWL_P} fill="none" stroke="var(--brand-foreground)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

// Their agents: a client's question, then sellers answering it, the last one ready to request.
function Theirs() {
  return (
    <svg className="home-art" viewBox="0 0 240 120" aria-hidden="true" focusable="false">
      <rect x="8" y="6" width="150" height="22" rx="11" fill="var(--tray)" />
      <rect x="20" y="14.5" width="96" height="5" rx="2.5" fill="var(--muted-foreground)" opacity="0.45" />
      <rect x="36" y="38" width="196" height="76" rx="14" fill="var(--tray)" />
      {[0, 1, 2].map((i) => (
        <g key={i} className={`a-row a-row-${i}`}>
          <rect x="46" y={48 + i * 21} width="176" height="16" rx="6" fill="var(--card)" />
          <circle cx="56" cy={56 + i * 21} r="4" fill={i === 1 ? "var(--brand)" : "var(--muted-foreground)"} opacity={i === 1 ? 1 : 0.35} />
          <rect x="66" y={54 + i * 21} width={i === 1 ? 70 : 54} height="4" rx="2" fill="var(--foreground)" opacity="0.7" />
          <rect x="146" y={54 + i * 21} width="22" height="4" rx="2" fill="var(--muted-foreground)" opacity="0.5" />
        </g>
      ))}
      <g className="a-press">
        <rect x="176" y="69" width="40" height="14" rx="7" fill="var(--brand)" />
        <rect x="186" y="74.5" width="20" height="3" rx="1.5" fill="var(--brand-foreground)" />
      </g>
    </svg>
  );
}

const MEMBERS = [24, 60, 96] as const;

// The money and the rules: a payment comes in, a person says yes, each share goes out once.
function Middle() {
  return (
    <svg className="home-art" viewBox="0 0 240 120" aria-hidden="true" focusable="false">
      <path d="M34 60H100" stroke="var(--band-line)" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" />
      {MEMBERS.map((y) => (
        <path key={y} d={`M140 60L206 ${y}`} stroke="var(--band-line)" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" />
      ))}
      <rect x="10" y="48" width="26" height="24" rx="6" fill="var(--band-raise)" />
      <rect x="15" y="55" width="16" height="3" rx="1.5" fill="var(--band-muted)" />
      <circle className="a-coin" cx="40" cy="60" r="5" fill="var(--brand)" />
      <Bowl x={120} y={60} size={34} />
      <path className="a-check" d="M110 26l6 6 12-12" fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
      {MEMBERS.map((y, i) => (
        <circle key={`d${y}`} className={`a-share a-share-${i}`} cx="140" cy="60" r="4" fill="var(--brand)" />
      ))}
      {MEMBERS.map((y, i) => (
        <circle key={`m${y}`} className={`a-member a-member-${i}`} cx="214" cy={y} r="9" fill="var(--band-raise)" />
      ))}
    </svg>
  );
}

// Your agents: a draft writes itself, then waits for a person's press.
function Yours() {
  return (
    <svg className="home-art" viewBox="0 0 240 120" aria-hidden="true" focusable="false">
      <rect x="8" y="8" width="224" height="104" rx="14" fill="var(--brand-foreground)" opacity="0.08" />
      <rect x="20" y="20" width="44" height="6" rx="3" fill="var(--brand-foreground)" opacity="0.45" />
      {[0, 1, 2].map((i) => (
        <rect key={i} className={`a-line a-line-${i}`} x="20" y={38 + i * 14} width={[150, 120, 90][i]} height="6" rx="3" fill="var(--brand-foreground)" opacity="0.8" />
      ))}
      <g className="a-confirm">
        <rect x="150" y="82" width="70" height="20" rx="10" fill="var(--brand-foreground)" />
        <rect x="166" y="90" width="38" height="4" rx="2" fill="var(--brand)" />
      </g>
      <path className="a-check a-late" d="M128 92l5 5 10-10" fill="none" stroke="var(--brand-foreground)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
    </svg>
  );
}

const SIDES = { theirs: Theirs, middle: Middle, yours: Yours };

export function SideArt({ name }: { name: keyof typeof SIDES }) {
  const Art = SIDES[name];
  return <Art />;
}

// The network: sellers of work reach a client's AI through one connector.
export function NetworkArt() {
  return (
    <svg className="home-art network-art" viewBox="0 0 480 140" aria-hidden="true" focusable="false">
      <rect width="480" height="140" rx="20" fill="var(--band)" />
      <rect x="24" y="20" width="200" height="100" rx="14" fill="var(--band-raise)" />
      <rect x="38" y="32" width="110" height="14" rx="7" fill="var(--band)" />
      {[0, 1].map((i) => (
        <g key={i} className={`a-row a-row-${i}`}>
          <rect x="38" y={56 + i * 28} width="172" height="22" rx="7" fill="var(--band)" />
          <circle cx="51" cy={67 + i * 28} r="5" fill="var(--brand)" />
          <rect x="62" y={65 + i * 28} width={i ? 64 : 84} height="4" rx="2" fill="var(--band-ink)" opacity="0.8" />
          <rect x="176" y={65 + i * 28} width="22" height="4" rx="2" fill="var(--band-muted)" />
        </g>
      ))}
      <path className="a-wire" d="M232 70H340" stroke="var(--brand)" strokeWidth="2.5" strokeDasharray="3 7" strokeLinecap="round" />
      <Bowl x={362} y={70} size={36} />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={404 + (i % 2) * 28} y={38 + i * 24} width="22" height="18" rx="5" fill="var(--band-raise)" />
      ))}
    </svg>
  );
}
