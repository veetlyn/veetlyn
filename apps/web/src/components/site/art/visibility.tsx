import { LOGO_PATHS } from "@/content/site/logos";

// Visibility page pictures, in the home pictures' language: rounded blocks, the brand's mint as the signal, one slow
// loop each (site.css "home-*" and "vis-*" keyframes); reduced motion shows the end state.

// Structured data: an offer whose facts become labels a machine can read.
function Labelled() {
  return (
    <svg className="home-art" viewBox="0 0 280 120" aria-hidden="true" focusable="false">
      <rect x="6" y="10" width="150" height="100" rx="14" fill="var(--tray)" />
      <rect x="20" y="24" width="90" height="8" rx="4" fill="var(--foreground)" opacity="0.75" />
      <rect x="20" y="40" width="120" height="5" rx="2.5" fill="var(--muted-foreground)" opacity="0.45" />
      <rect x="20" y="52" width="104" height="5" rx="2.5" fill="var(--muted-foreground)" opacity="0.45" />
      <rect x="20" y="80" width="40" height="16" rx="8" fill="var(--card)" />
      <rect x="66" y="80" width="30" height="16" rx="8" fill="var(--card)" />
      <path d="M164 60h18" stroke="var(--brand)" strokeWidth="2.5" strokeDasharray="2 5" strokeLinecap="round" className="a-wire" />
      {["Service", "$45", "45 min", "Brooklyn"].map((label, i) => (
        <g key={label} className={`a-row a-row-${i % 3}`}>
          <rect x="190" y={14 + i * 24} width={[66, 40, 58, 74][i]} height="18" rx="9" fill={i === 1 ? "var(--brand)" : "var(--card)"} stroke="var(--border)" />
          <rect x="200" y={21 + i * 24} width={[44, 20, 38, 54][i]} height="4" rx="2" fill={i === 1 ? "var(--brand-foreground)" : "var(--foreground)"} opacity="0.7" />
        </g>
      ))}
    </svg>
  );
}

// Crawlers: AI readers arrive at an open page.
function Crawlers() {
  return (
    <svg className="home-art" viewBox="0 0 160 110" aria-hidden="true" focusable="false">
      <rect x="92" y="18" width="56" height="74" rx="10" fill="var(--tray)" />
      <rect x="102" y="30" width="34" height="5" rx="2.5" fill="var(--foreground)" opacity="0.6" />
      <rect x="102" y="42" width="28" height="4" rx="2" fill="var(--muted-foreground)" opacity="0.5" />
      <rect x="102" y="52" width="36" height="4" rx="2" fill="var(--muted-foreground)" opacity="0.5" />
      {[0, 1, 2].map((i) => (
        <g key={i} className={`vis-crawl vis-crawl-${i}`}>
          <rect x="10" y={16 + i * 28} width="22" height="20" rx="6" fill={i === 1 ? "var(--brand)" : "var(--band)"} />
          <circle cx="17" cy={26 + i * 28} r="2" fill={i === 1 ? "var(--brand-foreground)" : "var(--band-ink)"} />
          <circle cx="25" cy={26 + i * 28} r="2" fill={i === 1 ? "var(--brand-foreground)" : "var(--band-ink)"} />
        </g>
      ))}
    </svg>
  );
}

// Speed: a gauge that settles in the fast zone.
function Speed() {
  return (
    <svg className="home-art" viewBox="0 0 160 110" aria-hidden="true" focusable="false">
      <path d="M30 86a50 50 0 0 1 100 0" fill="none" stroke="var(--tray)" strokeWidth="12" strokeLinecap="round" />
      <path d="M100 42a50 50 0 0 1 30 44" fill="none" stroke="var(--brand)" strokeWidth="12" strokeLinecap="round" />
      <g className="vis-needle">
        <path d="M80 86L80 46" stroke="var(--foreground)" strokeWidth="4" strokeLinecap="round" />
      </g>
      <circle cx="80" cy="86" r="7" fill="var(--foreground)" />
    </svg>
  );
}

// Discover: a catalog where your tile lights up.
function Discover() {
  return (
    <svg className="home-art" viewBox="0 0 160 110" aria-hidden="true" focusable="false">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} className={i === 4 ? "vis-lit" : undefined} x={20 + (i % 3) * 42} y={14 + Math.floor(i / 3) * 44} width="36" height="38" rx="8" fill="var(--tray)" />
      ))}
    </svg>
  );
}

// Your own address: the address types itself.
function Domain() {
  return (
    <svg className="home-art" viewBox="0 0 160 110" aria-hidden="true" focusable="false">
      <rect x="8" y="38" width="144" height="34" rx="17" fill="var(--tray)" />
      <circle cx="28" cy="55" r="6" fill="none" stroke="var(--muted-foreground)" strokeWidth="2" />
      <rect className="vis-type" x="42" y="51" width="92" height="8" rx="4" fill="var(--foreground)" opacity="0.75" />
      <rect className="vis-caret" x="138" y="47" width="2.5" height="16" rx="1" fill="var(--brand)" />
    </svg>
  );
}

// Found in AI: a client's chat names you.
function FoundInAi() {
  return (
    <svg className="home-art" viewBox="0 0 280 120" aria-hidden="true" focusable="false">
      <rect x="110" y="8" width="160" height="24" rx="12" fill="var(--band-raise)" />
      <rect x="122" y="17.5" width="108" height="5" rx="2.5" fill="var(--band-muted)" />
      <g className="a-row a-row-1">
        <rect x="10" y="44" width="220" height="64" rx="14" fill="var(--band-raise)" />
        <circle cx="32" cy="66" r="9" fill="var(--brand)" />
        <rect x="50" y="62" width="96" height="6" rx="3" fill="var(--band-ink)" opacity="0.85" />
        <rect x="50" y="76" width="70" height="4" rx="2" fill="var(--band-muted)" />
        <rect x="24" y="90" width="150" height="4" rx="2" fill="var(--band-muted)" opacity="0.6" />
      </g>
      <g className="a-press">
        <rect x="178" y="84" width="44" height="16" rx="8" fill="var(--brand)" />
        <rect x="188" y="90" width="24" height="4" rx="2" fill="var(--brand-foreground)" />
      </g>
    </svg>
  );
}

export const SEO_ART = { labelled: Labelled, crawlers: Crawlers, speed: Speed, discover: Discover, domain: Domain, found: FoundInAi };

export function SeoArt({ name }: { name: keyof typeof SEO_ART }) {
  const Art = SEO_ART[name];
  return <Art />;
}

const ENGINES = [LOGO_PATHS.openai, LOGO_PATHS.claude, LOGO_PATHS.perplexity, LOGO_PATHS.googlegemini] as const;

// Track: how often each assistant names you, one bar rising as fixes land.
function Track() {
  return (
    <svg className="home-art" viewBox="0 0 320 200" aria-hidden="true" focusable="false">
      {ENGINES.map((logo, i) => (
        <g key={logo}>
          <path d={logo} transform={`translate(16 ${14 + i * 44})`} fill="var(--band-ink)" />
          <rect x="50" y={22 + i * 44} width="40" height="8" rx="4" fill="var(--band-muted)" />
          <rect x="104" y={18 + i * 44} width="196" height="16" rx="8" fill="var(--band-raise)" />
          <rect className={i === 1 ? "vis-grow" : undefined} x="104" y={18 + i * 44} width={[120, 168, 86, 104][i]} height="16" rx="8" fill={i === 1 ? "var(--brand)" : "var(--band-line)"} />
        </g>
      ))}
    </svg>
  );
}

// Write: a guide drafts itself and waits for your yes.
function Write() {
  return (
    <svg className="home-art" viewBox="0 0 320 200" aria-hidden="true" focusable="false">
      <rect x="40" y="14" width="240" height="172" rx="18" fill="var(--band-raise)" />
      <rect x="62" y="36" width="130" height="10" rx="5" fill="var(--band-ink)" opacity="0.9" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} className={`a-line a-line-${i % 3}`} x="62" y={62 + i * 18} width={[190, 170, 182, 120][i]} height="6" rx="3" fill="var(--band-muted)" />
      ))}
      <g className="a-confirm">
        <rect x="178" y="146" width="84" height="24" rx="12" fill="var(--brand)" />
        <rect x="196" y="155" width="48" height="5" rx="2.5" fill="var(--brand-foreground)" />
      </g>
      <path className="a-check a-late" d="M150 158l6 6 12-12" fill="none" stroke="var(--brand)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
    </svg>
  );
}

// Keep: a weekly report whose bars climb, with the checks that keep it honest.
function Keep() {
  return (
    <svg className="home-art" viewBox="0 0 320 200" aria-hidden="true" focusable="false">
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const h = [40, 58, 50, 76, 92, 120][i] ?? 40;
        return <rect key={i} className="vis-bar" style={{ animationDelay: `${i * 0.12}s` }} x={30 + i * 30} y={170 - h} width="20" height={h} rx="5" fill={i === 5 ? "var(--brand)" : "var(--band-raise)"} />;
      })}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="222" y={54 + i * 34} width="80" height="22" rx="11" fill="var(--band-raise)" />
          <path d={`M232 ${65 + i * 34}l4 4 8-8`} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="252" y={63 + i * 34} width="38" height="4" rx="2" fill="var(--band-muted)" />
        </g>
      ))}
    </svg>
  );
}

export const AGENT_ART = { track: Track, write: Write, keep: Keep };

export function AgentArt({ name }: { name: keyof typeof AGENT_ART }) {
  const Art = AGENT_ART[name];
  return <Art />;
}
