// Pictures for the home page's terms, in the home pictures' language (site.css "home-*" and "terms-*" keyframes).

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

// The client's AI asks and requests; paying leaves the chat for PayPal.
function Assistants() {
  return (
    <svg className="home-art" viewBox="0 0 320 130" aria-hidden="true" focusable="false">
      <rect x="8" y="8" width="200" height="114" rx="16" fill="var(--band-raise)" />
      <rect x="64" y="20" width="132" height="18" rx="9" fill="var(--band)" />
      <rect x="76" y="27" width="84" height="4" rx="2" fill="var(--band-muted)" />
      <g className="a-row a-row-0">
        <rect x="20" y="48" width="176" height="30" rx="9" fill="var(--band)" />
        <circle cx="35" cy="63" r="6" fill="var(--brand)" />
        <rect x="48" y="60" width="66" height="5" rx="2.5" fill="var(--band-ink)" opacity="0.85" />
        <g className="a-press">
          <rect x="140" y="55" width="48" height="16" rx="8" fill="var(--brand)" />
          <rect x="150" y="61" width="28" height="4" rx="2" fill="var(--brand-foreground)" />
        </g>
      </g>
      <g className="a-row a-row-1">
        <rect x="20" y="86" width="176" height="26" rx="9" fill="var(--band)" />
        <rect x="32" y="97" width="58" height="4" rx="2" fill="var(--band-muted)" />
        <rect x="140" y="91" width="48" height="16" rx="8" fill="none" stroke="var(--band-line)" strokeDasharray="3 3" />
        <path d="M159 96v-2a5 5 0 0 1 10 0v2m-11 0h12v8h-12z" fill="none" stroke="var(--band-muted)" strokeWidth="1.6" strokeLinejoin="round" />
      </g>
      <path className="a-wire" d="M214 99H252" stroke="var(--brand)" strokeWidth="2.5" strokeDasharray="3 7" strokeLinecap="round" />
      <rect x="258" y="84" width="54" height="30" rx="10" fill="var(--brand)" />
      <rect x="270" y="97" width="30" height="4" rx="2" fill="var(--brand-foreground)" />
    </svg>
  );
}

// The quoted price and the charged price are the same number.
function Checkout() {
  return (
    <svg className="home-art" viewBox="0 0 200 120" aria-hidden="true" focusable="false">
      <rect x="6" y="20" width="78" height="80" rx="12" fill="var(--tray)" />
      <rect x="16" y="32" width="40" height="4" rx="2" fill="var(--muted-foreground)" opacity="0.5" />
      <rect x="16" y="50" width="54" height="12" rx="4" fill="var(--foreground)" opacity="0.8" />
      <rect x="116" y="20" width="78" height="80" rx="12" fill="var(--tray)" />
      <rect x="126" y="32" width="40" height="4" rx="2" fill="var(--muted-foreground)" opacity="0.5" />
      <rect x="126" y="50" width="54" height="12" rx="4" fill="var(--foreground)" opacity="0.8" />
      <rect x="126" y="76" width="58" height="14" rx="7" fill="var(--brand)" />
      <path d="M92 54h16M92 64h16" stroke="var(--muted-foreground)" strokeWidth="3" strokeLinecap="round" />
      <path className="a-check" d="M90 92l6 6 12-12" fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
    </svg>
  );
}

const MEMBERS = [24, 60, 96] as const;

// A payment comes in, a person says yes, each share goes out once.
function Payouts() {
  return (
    <svg className="home-art" viewBox="0 0 240 120" aria-hidden="true" focusable="false">
      <path d="M34 60H100" stroke="var(--band-line)" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" />
      {MEMBERS.map((y) => (
        <path key={y} d={`M140 60L206 ${y}`} stroke="var(--band-line)" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" />
      ))}
      <rect x="10" y="48" width="26" height="24" rx="6" fill="var(--band-raise)" />
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

// In the team's chat, the agent posts a draft and a person confirms it.
function TeamChat() {
  return (
    <svg className="home-art" viewBox="0 0 200 120" aria-hidden="true" focusable="false">
      <g className="a-row a-row-0">
        <Bowl x={20} y={22} size={20} />
        <rect x="36" y="8" width="150" height="62" rx="12" fill="var(--tray)" />
        <rect x="48" y="20" width="64" height="5" rx="2.5" fill="var(--foreground)" opacity="0.75" />
        <rect x="48" y="32" width="110" height="4" rx="2" fill="var(--muted-foreground)" opacity="0.5" />
        <rect x="48" y="42" width="90" height="4" rx="2" fill="var(--muted-foreground)" opacity="0.5" />
      </g>
      <g className="a-confirm">
        <rect x="108" y="80" width="78" height="22" rx="11" fill="var(--foreground)" />
        <rect x="126" y="89" width="42" height="4" rx="2" fill="var(--background)" />
      </g>
      <circle cx="88" cy="91" r="9" fill="var(--tray)" />
      <circle cx="88" cy="88" r="3.5" fill="var(--muted-foreground)" opacity="0.6" />
      <path className="a-check a-late" d="M160 22l4 4 9-9" fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
    </svg>
  );
}

// Your own agent's call meets the same approval as a person's.
function Api() {
  return (
    <svg className="home-art" viewBox="0 0 200 120" aria-hidden="true" focusable="false">
      <rect x="6" y="10" width="188" height="100" rx="14" fill="var(--band)" />
      <circle cx="20" cy="22" r="3" fill="var(--band-raise)" />
      <circle cx="30" cy="22" r="3" fill="var(--band-raise)" />
      {[0, 1, 2].map((i) => (
        <rect key={i} className={`a-line a-line-${i}`} x={i === 1 ? 32 : 20} y={38 + i * 14} width={[96, 120, 70][i]} height="5" rx="2.5" fill={i === 0 ? "var(--brand)" : "var(--band-muted)"} />
      ))}
      <g className="a-confirm">
        <rect x="20" y="84" width="92" height="16" rx="8" fill="var(--band-raise)" />
        <circle cx="31" cy="92" r="3.5" fill="var(--brand)" />
        <rect x="40" y="90" width="62" height="4" rx="2" fill="var(--band-ink)" opacity="0.8" />
      </g>
    </svg>
  );
}

// Every offer says who does the work: people, AI or both.
function WhoDoes() {
  const kinds = [
    { x: 12, people: true, ai: false },
    { x: 116, people: false, ai: true },
    { x: 220, people: true, ai: true },
  ];
  return (
    <svg className="home-art" viewBox="0 0 320 120" aria-hidden="true" focusable="false">
      {kinds.map((k, i) => (
        <g key={k.x} className={`a-row a-row-${i}`}>
          <rect x={k.x} y="14" width="92" height="92" rx="14" fill="var(--brand-foreground)" opacity="0.1" />
          <rect x={k.x + 12} y="72" width="52" height="5" rx="2.5" fill="var(--brand-foreground)" opacity="0.7" />
          <rect x={k.x + 12} y="84" width="36" height="4" rx="2" fill="var(--brand-foreground)" opacity="0.4" />
          {k.people && (
            <g>
              <circle cx={k.x + 26} cy="36" r="7" fill="var(--brand-foreground)" />
              <path d={`M${k.x + 14} 58a12 12 0 0 1 24 0z`} fill="var(--brand-foreground)" />
            </g>
          )}
          {k.ai && (
            <g transform={`translate(${k.people ? k.x + 46 : k.x + 14} 26)`}>
              <rect width="26" height="24" rx="7" fill="var(--brand-foreground)" />
              <circle cx="8.5" cy="12" r="2.5" fill="var(--brand)" />
              <circle cx="17.5" cy="12" r="2.5" fill="var(--brand)" />
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}

export const TERMS_ART = { assistants: Assistants, checkout: Checkout, payouts: Payouts, chat: TeamChat, api: Api, who: WhoDoes };

export function TermsArt({ name }: { name: keyof typeof TERMS_ART }) {
  const Art = TERMS_ART[name];
  return <Art />;
}
